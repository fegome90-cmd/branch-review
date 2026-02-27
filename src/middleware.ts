import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const REVIEW_TOKEN_COOKIE_NAME = 'review_api_token';
const UNAUTH_RATE_LIMIT_WINDOW_MS = 60_000;
const UNAUTH_RATE_LIMIT_MAX_REQUESTS = 30;

type RateBucket = {
  count: number;
  windowStartMs: number;
};

const unauthRateBuckets = new Map<string, RateBucket>();

function applySecurityHeaders(response: NextResponse) {
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', '),
  );
  return response;
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown-ip'
  );
}

function isUnauthenticatedReviewApiRequest(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/review/')) {
    return false;
  }

  const hasHeaderToken = Boolean(request.headers.get('x-review-token'));
  const hasCookieToken = Boolean(
    request.cookies.get(REVIEW_TOKEN_COOKIE_NAME)?.value,
  );

  return !hasHeaderToken && !hasCookieToken;
}

function consumeUnauthRateLimit(request: NextRequest) {
  const key = `${getClientIp(request)}:${request.nextUrl.pathname}`;
  const now = Date.now();
  const existing = unauthRateBuckets.get(key);

  if (
    !existing ||
    now - existing.windowStartMs >= UNAUTH_RATE_LIMIT_WINDOW_MS
  ) {
    unauthRateBuckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: UNAUTH_RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  existing.count += 1;
  unauthRateBuckets.set(key, existing);

  return {
    allowed: existing.count <= UNAUTH_RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(UNAUTH_RATE_LIMIT_MAX_REQUESTS - existing.count, 0),
  };
}

export function middleware(request: NextRequest) {
  if (isUnauthenticatedReviewApiRequest(request)) {
    const rate = consumeUnauthRateLimit(request);
    if (!rate.allowed) {
      const response = NextResponse.json(
        {
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message:
              'Too many unauthenticated requests. Please try again later.',
          },
        },
        { status: 429 },
      );
      response.headers.set('Retry-After', '60');
      response.headers.set(
        'X-RateLimit-Limit',
        String(UNAUTH_RATE_LIMIT_MAX_REQUESTS),
      );
      response.headers.set('X-RateLimit-Remaining', String(rate.remaining));
      return applySecurityHeaders(response);
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
