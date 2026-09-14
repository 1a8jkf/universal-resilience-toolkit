import { createRetry, retry } from '@1a8jkf/universal-resilience-toolkit/retry';
import { RateLimitError } from '@1a8jkf/universal-resilience-toolkit';
import { assert, equal, fakeClock, rejects, test } from './harness';

test('retry preserves return values and one-based attempt context', async () => {
  const attempts: number[] = [];
  const clock = fakeClock();
  equal(
    await retry(
      ({ attempt }) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error('temporary');
        return 42;
      },
      { clock, initialDelay: 10, jitter: 'none' },
    ),
    42,
  );
  equal(attempts, [1, 2, 3]);
  equal(clock.delays, [10, 20]);
});
test('retry caps exponential backoff and applies full and equal jitter', async () => {
  for (const jitter of ['none', 'full', 'equal'] as const) {
    const clock = fakeClock();
    await rejects(
      () =>
        retry(
          () => {
            throw new Error('failure');
          },
          {
            clock,
            maxAttempts: 4,
            initialDelay: 10,
            maxDelay: 15,
            jitter,
            random: () => 0.5,
          },
        ),
      'Error',
    );
    equal(
      clock.delays,
      jitter === 'none'
        ? [10, 15, 15]
        : jitter === 'full'
          ? [5, 7.5, 7.5]
          : [7.5, 11.25, 11.25],
    );
  }
});
test('retry can filter failures and never retries policy rejections', async () => {
  let calls = 0;
  await rejects(
    () =>
      retry(
        () => {
          calls++;
          throw new RateLimitError(10, 'test');
        },
        { maxAttempts: 5 },
      ),
    'RateLimitError',
  );
  equal(calls, 1);
  await rejects(
    () =>
      retry(
        () => {
          calls++;
          throw new Error('permanent');
        },
        { shouldRetry: () => false },
      ),
    'Error',
  );
  equal(calls, 2);
});
test('retry validates options and rejects invalid randomness', async () => {
  await rejects(() => createRetry({ maxAttempts: 0 }), 'ConfigurationError');
  await rejects(() => createRetry({ factor: Infinity }), 'ConfigurationError');
  await rejects(
    () =>
      retry(
        () => {
          throw new Error('failure');
        },
        { random: () => 1 },
      ),
    'ConfigurationError',
  );
});
test('timeouts bound hung operations and signal cooperative cancellation', async () => {
  let aborted = false;
  await rejects(
    () =>
      retry(
        ({ signal }) =>
          new Promise(() => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
        { maxAttempts: 1 },
        { timeout: 10 },
      ),
    'TimeoutError',
  );
  assert(aborted);
});
test('caller abort cancels attempts and retry sleep', async () => {
  const cancelled = new AbortController();
  cancelled.abort('stop');
  let calls = 0;
  await rejects(
    () =>
      retry(
        () => {
          calls++;
        },
        {},
        { signal: cancelled.signal },
      ),
    'AbortError',
  );
  equal(calls, 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await rejects(
      () =>
        retry(
          () => {
            throw new Error('failure');
          },
          { initialDelay: '1s', jitter: 'none' },
          { signal: controller.signal },
        ),
      'AbortError',
    );
  } finally {
    clearTimeout(timer);
  }
});
