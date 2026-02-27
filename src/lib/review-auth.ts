import { timingSafeEqual } from 'node:crypto';

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    const mismatch = Buffer.alloc(leftBuffer.length);
    timingSafeEqual(leftBuffer, mismatch);
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isReviewTokenAuthorized(providedToken: string | null) {
  const currentToken = process.env.REVIEW_API_TOKEN;
  const previousToken = process.env.REVIEW_API_TOKEN_PREVIOUS;

  if (!currentToken || !providedToken) {
    return false;
  }

  if (safeEqual(providedToken, currentToken)) {
    return true;
  }

  if (previousToken && safeEqual(providedToken, previousToken)) {
    return true;
  }

  // P1-1: Log failed auth attempts for security monitoring (without exposing token)
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Authentication failed',
      providedTokenLength: providedToken.length,
    }),
  );

  return false;
}
