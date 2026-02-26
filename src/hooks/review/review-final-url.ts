export function buildReviewFinalUrl(runId: string) {
  return `/api/review/final?runId=${encodeURIComponent(runId)}`;
}
