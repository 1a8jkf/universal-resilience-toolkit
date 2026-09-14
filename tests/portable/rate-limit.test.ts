import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';
import { createRateLimiter } from '@1a8jkf/universal-resilience-toolkit/rate-limit';
import { assert, equal, fakeClock, rejects, test } from './harness';

for (const algorithm of ['token-bucket', 'sliding-window'] as const) {
  test(`${algorithm}: atomic admission under 200 concurrent calls and shared wrappers`, async () => {
    const store = new MemoryStore();
    const clock = fakeClock();
    const options = {
      algorithm,
      tokensPerInterval: 10,
      interval: 1000,
      store,
      clock,
      key: 'shared',
    };
    const a = createRateLimiter(options);
    const b = createRateLimiter(options);
    const results = await Promise.allSettled(
      Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).acquire()),
    );
    equal(results.filter((r) => r.status === 'fulfilled').length, 10);
    clock.advance(1000);
    await a.acquire();
  });
  test(`${algorithm}: exact boundaries, clock rollback, and conflicting configuration`, async () => {
    const store = new MemoryStore();
    const clock = fakeClock();
    const limiter = createRateLimiter({
      algorithm,
      tokensPerInterval: 1,
      interval: 1000,
      store,
      clock,
      key: 'boundary',
    });
    await limiter.acquire();
    clock.advance(-100);
    const error = await rejects(() => limiter.acquire(), 'RateLimitError');
    assert('retryAfterMs' in error);
    equal(error.retryAfterMs, 1000);
    clock.advance(1099);
    await rejects(() => limiter.acquire(), 'RateLimitError');
    clock.advance(1);
    await limiter.acquire();
    await rejects(
      () =>
        createRateLimiter({
          tokensPerInterval: 2,
          interval: 1000,
          key: 'boundary',
          store,
          clock,
        }).acquire(),
      'ConfigurationError',
    );
  });
}
test('token bucket refills continuously and supports burst capacity', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    tokensPerInterval: 2,
    capacity: 3,
    interval: 1000,
    clock,
    store: new MemoryStore(),
  });
  await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
  await rejects(() => limiter.acquire(), 'RateLimitError');
  clock.advance(500);
  await limiter.acquire();
});
test('rate limiter rejects invalid configuration before touching storage', async () => {
  await rejects(
    () => createRateLimiter({ tokensPerInterval: -1, interval: 100 }),
    'ConfigurationError',
  );
  await rejects(
    () => createRateLimiter({ tokensPerInterval: 1, interval: '0s' }),
    'ConfigurationError',
  );
  await rejects(
    () =>
      createRateLimiter({
        tokensPerInterval: 1,
        interval: 1,
        algorithm: 'sliding-window',
        capacity: 2,
      }),
    'ConfigurationError',
  );
});
