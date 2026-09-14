import {
  withResilience,
  createResilience,
} from '@1a8jkf/universal-resilience-toolkit';
import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';
import { createCircuitBreaker } from '@1a8jkf/universal-resilience-toolkit/circuit-breaker';
import { equal, fakeClock, rejects, test } from './harness';

test('composition retries real operations and opens circuit on cascading failures', async () => {
  let calls = 0;
  const clock = fakeClock();
  const store = new MemoryStore();
  const options = {
    store,
    key: 'cascade',
    retry: { maxAttempts: 5, clock, initialDelay: 0 },
    circuitBreaker: { failureThreshold: 2, clock },
  };
  const wrapped = withResilience(() => {
    calls++;
    throw new Error('failed');
  }, options);
  await rejects(() => wrapped(), 'CircuitOpenError');
  equal(calls, 2);
  equal(
    await createCircuitBreaker({
      ...options.circuitBreaker,
      store,
      key: 'cascade',
    }).getState(),
    'open',
  );
});
test('composition spends tokens on each retry and does not count rate rejections', async () => {
  let calls = 0;
  const store = new MemoryStore();
  const clock = fakeClock();
  const wrapped = withResilience(
    () => {
      calls++;
      throw new Error('failed');
    },
    {
      store,
      key: 'limited',
      retry: { clock, initialDelay: 0 },
      rateLimit: { tokensPerInterval: 1, interval: 1000, clock },
      circuitBreaker: { failureThreshold: 2, clock },
    },
  );
  await rejects(() => wrapped(), 'RateLimitError');
  equal(calls, 1);
  equal(
    await createCircuitBreaker({
      store,
      key: 'limited',
      failureThreshold: 2,
      clock,
    }).getState(),
    'closed',
  );
});
test('withResilience preserves arguments, receiver, and concurrency isolation', async () => {
  const wrapped = withResilience(function (
    this: { offset: number },
    value: number,
    label: string,
  ) {
    return `${label}:${value + this.offset}`;
  });
  equal(await wrapped.call({ offset: 3 }, 4, 'result'), 'result:7');
  const concurrent = withResilience(async (value: number) => {
    await Promise.resolve();
    return value * 2;
  });
  equal(
    await Promise.all(Array.from({ length: 50 }, (_, i) => concurrent(i))),
    Array.from({ length: 50 }, (_, i) => i * 2),
  );
});
test('composed timeout counts circuit failure and context exposes the retry attempt', async () => {
  const store = new MemoryStore();
  let count = 0;
  const resilient = createResilience(
    ({ attempt }) => {
      count = attempt;
      return new Promise(() => {});
    },
    {
      store,
      key: 'timeout',
      timeout: 5,
      retry: { maxAttempts: 2, initialDelay: 0 },
      circuitBreaker: { failureThreshold: 2 },
    },
  );
  await rejects(() => resilient.execute(), 'TimeoutError');
  equal(count, 2);
  equal(
    await createCircuitBreaker({
      store,
      key: 'timeout',
      failureThreshold: 2,
    }).getState(),
    'open',
  );
});
