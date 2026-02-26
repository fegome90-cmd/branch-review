import { NextResponse } from 'next/server';

type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

type ApiResponse<T> = {
  data: T | null;
  error: ApiErrorPayload | null;
};

const DEFAULT_ERROR_CODE = 'INTERNAL_ERROR';

export function jsonOk<T>(data: T, status = 200) {
  const payload: ApiResponse<T> = {
    data,
    error: null,
  };

  return NextResponse.json(payload, { status });
}

export function jsonFail(
  message: string,
  status: number,
  options?: { code?: string; details?: unknown },
) {
  const payload: ApiResponse<never> = {
    data: null,
    error: {
      code: options?.code || DEFAULT_ERROR_CODE,
      message,
      ...(options?.details !== undefined ? { details: options.details } : {}),
    },
  };

  return NextResponse.json(payload, { status });
}
