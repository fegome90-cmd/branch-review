import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonFail, jsonOk } from '@/lib/http';
import { isReviewTokenAuthorized } from '@/lib/review-auth';
import {
  buildClearedReviewTokenCookie,
  buildReviewTokenCookie,
} from '@/lib/review-token';

const tokenPayloadSchema = z.object({
  token: z.string().trim().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const requiredToken = process.env.REVIEW_API_TOKEN;
  if (!requiredToken) {
    return jsonFail('Server misconfigured: missing REVIEW_API_TOKEN', 503, {
      code: 'MISCONFIGURED',
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonFail('Invalid request payload', 400, {
      code: 'INVALID_INPUT',
    });
  }

  const payload = tokenPayloadSchema.safeParse(rawBody);
  if (!payload.success) {
    return jsonFail('Invalid request payload', 400, {
      code: 'INVALID_INPUT',
      details: payload.error.flatten(),
    });
  }

  if (!isReviewTokenAuthorized(payload.data.token)) {
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }

  const response = jsonOk({ authenticated: true });
  response.cookies.set(buildReviewTokenCookie(payload.data.token));
  return response;
}

export async function DELETE() {
  const response = jsonOk({ cleared: true });
  response.cookies.set(buildClearedReviewTokenCookie());
  return response;
}
