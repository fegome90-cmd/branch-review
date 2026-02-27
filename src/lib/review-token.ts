import type { NextRequest } from 'next/server';

export const REVIEW_TOKEN_COOKIE_NAME = 'review_api_token';
const REVIEW_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

function getCookieFromHeader(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  const chunks = cookieHeader.split(';').map((chunk) => chunk.trim());
  for (const chunk of chunks) {
    if (!chunk.startsWith(`${REVIEW_TOKEN_COOKIE_NAME}=`)) {
      continue;
    }

    return decodeURIComponent(chunk.slice(REVIEW_TOKEN_COOKIE_NAME.length + 1));
  }

  return null;
}

export function getReviewTokenFromRequest(request: NextRequest) {
  const cookieStore = (
    request as NextRequest & {
      cookies?: { get: (name: string) => { value?: string } | undefined };
    }
  ).cookies;
  const cookieToken = cookieStore?.get(REVIEW_TOKEN_COOKIE_NAME)?.value;
  if (cookieToken) {
    return cookieToken;
  }

  const headerCookieToken = getCookieFromHeader(request);
  if (headerCookieToken) {
    return headerCookieToken;
  }

  return request.headers.get('x-review-token');
}

export function buildReviewTokenCookie(token: string) {
  return {
    name: REVIEW_TOKEN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: REVIEW_TOKEN_COOKIE_MAX_AGE_SECONDS,
  };
}

export function buildClearedReviewTokenCookie() {
  return {
    name: REVIEW_TOKEN_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 0,
  };
}
