import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { jsonFail, jsonOk } from '@/lib/http';
import { logger } from '@/lib/logger';
import {
  commandSchema,
  ReviewCommandError,
  reviewCommandService,
} from '@/lib/review-command-service';
import { isReviewTokenAuthorized } from '@/lib/review-auth';

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

function getClientId(request: NextRequest) {
  const tokenId = request.headers.get('x-review-token');
  const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
  return tokenId ? `token:${tokenId}` : `ip:${ip}`;
}

function getRequestId(request: NextRequest) {
  return request.headers.get('x-request-id') || randomUUID();
}

function parseBody(rawBody: string) {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = '/api/review/command';
  const start = Date.now();

  logger.info('Review command request received', { requestId, route });

  const requiredToken = process.env.REVIEW_API_TOKEN;
  if (!requiredToken) {
    logger.error('Missing REVIEW_API_TOKEN configuration', { requestId, route });
    return jsonFail('Server misconfigured: missing REVIEW_API_TOKEN', 503, { code: 'MISCONFIGURED' });
  }

  const providedToken = request.headers.get('x-review-token');
  if (!isReviewTokenAuthorized(providedToken)) {
    logger.warn('Unauthorized review command request', { requestId, route });
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BODY_BYTES) {
    logger.warn('Review command payload too large', { requestId, route });
    return jsonFail('Payload too large', 413, { code: 'PAYLOAD_TOO_LARGE' });
  }

  const body = parseBody(rawBody);
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn('Invalid review command payload', { requestId, route });
    return jsonFail('Invalid request payload', 400, {
      code: 'INVALID_INPUT',
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await reviewCommandService.execute(parsed.data, {
      clientId: getClientId(request),
    });

    logger.info('Review command completed', {
      requestId,
      route,
      command: parsed.data.command,
      durationMs: Date.now() - start,
      status: 200,
    });

    return jsonOk({ output: result.output });
  } catch (error) {
    if (error instanceof ReviewCommandError) {
      logger.warn('Review command failed', {
        requestId,
        route,
        command: parsed.data.command,
        status: error.status,
        code: error.code,
        durationMs: Date.now() - start,
      });

      return jsonFail(error.message, error.status, {
        code: error.code,
        details: error.details,
      });
    }

    logger.error('Unexpected review command error', {
      requestId,
      route,
      durationMs: Date.now() - start,
    });

    return jsonFail('Command execution failed', 500, { code: 'INTERNAL_ERROR' });
  }
}
