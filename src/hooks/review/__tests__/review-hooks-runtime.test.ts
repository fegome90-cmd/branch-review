import { beforeEach, describe, expect, it, mock } from 'bun:test';

function mockReactHooks() {
  mock.module('react', () => ({
    useState: (initial: unknown) => {
      let value =
        typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const setValue = (next: unknown) => {
        value =
          typeof next === 'function'
            ? (next as (prev: unknown) => unknown)(value)
            : next;
      };
      return [value, setValue] as const;
    },
    useEffect: (effect: () => void | (() => void)) => {
      effect();
    },
    useCallback: <T>(callback: T) => callback,
  }));
}

describe('review hooks runtime behavior', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('useReviewCommand executes command requests', async () => {
    mockReactHooks();
    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ data: { output: 'ok' }, error: null })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { useReviewCommand } = await import(
      '@/hooks/review/use-review-command'
    );
    const hook = useReviewCommand();
    const output = await hook.execute({
      command: 'plan',
      token: 'token',
      args: {},
    });

    expect(output).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('useReviewFinal refreshes and handles missing runId', async () => {
    mockReactHooks();
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({ data: { result: { run_id: 'r1' } }, error: null }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { useReviewFinal } = await import('@/hooks/review/use-review-final');
    const withoutRun = useReviewFinal(null);
    await withoutRun.refresh();

    const withRun = useReviewFinal('run/test');
    await withRun.refresh();

    expect(fetchMock).toHaveBeenCalled();
  });

  it('useReviewRun refreshes run state through API', async () => {
    mockReactHooks();
    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ data: { run: null }, error: null }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { useReviewRun } = await import('@/hooks/review/use-review-run');
    const hook = useReviewRun();
    await hook.refresh();

    expect(fetchMock).toHaveBeenCalledWith('/api/review/run');
  });
});
