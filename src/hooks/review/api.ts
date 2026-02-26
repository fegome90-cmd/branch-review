import type { ApiResponse } from '@/components/review/types';

const DEFAULT_ERROR_MESSAGE = 'Request failed';

function mapStatusMessage(status: number) {
  if (status === 401)
    return 'Unauthorized: review token is missing or invalid.';
  if (status === 413) return 'Payload too large.';
  if (status === 429) return 'Too many requests. Try again in a moment.';
  if (status === 503) return 'Service unavailable. Check server configuration.';
  if (status >= 500) return 'Server error. Please retry.';
  return DEFAULT_ERROR_MESSAGE;
}

export async function parseApiEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>;

  if (response.ok && !payload.error && payload.data !== null) {
    return payload.data;
  }

  const errorMessage =
    payload.error?.message ?? mapStatusMessage(response.status);
  throw new Error(errorMessage);
}
