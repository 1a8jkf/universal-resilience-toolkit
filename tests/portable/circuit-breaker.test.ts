import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';
import { createCircuitBreaker } from '@1a8jkf/universal-resilience-toolkit/circuit-breaker';
import { RateLimitError } from '@1a8jkf/universal-resilience-toolkit';
import { equal, fakeClock, rejects, test } from './harness';

const fail = () => {
  throw new Error('dependency failed');
};
test('circuit transitions closed/open/half-open/closed with a single shared recovery probe', async () => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const options = {
    store,
    clock,
    key: 'shared',
    failureThreshold: 2,
    resetTimeout: 100,
  };
  const a = createCircuitBreaker(options);
  const b = createCircuitBreaker(options);
  await rejects(() => a.execute(fail), 'Error');
  await rejects(() => b.execute(fail), 'Error');
  equal(await a.getState(), 'open');
  await rejects(() => a.execute(() => 1), 'CircuitOpenError');
  clock.advance(100);
  let release!: (value: number) => void;
  const pending = a.execute(
    () =>
      new Promise<number>((resolve) => {
        release = resolve;
      }),
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  equal(await b.getState(), 'half-open');
  const rejected = await Promise.allSettled(
    Array.from({ length: 100 }, () => b.execute(() => 0)),
  );
  equal(rejected.filter((r) => r.status === 'fulfilled').length, 0);
  release(7);
  equal(await pending, 7);
  equal(await b.getState(), 'closed');
});
test('late closed completions cannot close a newly opened circuit', async () => {
  const circuit = createCircuitBreaker({
    store: new MemoryStore(),
    failureThreshold: 1,
  });
  let release!: () => void;
  const pending = circuit.execute(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await rejects(() => circuit.execute(fail), 'Error');
  release();
  await pending;
  equal(await circuit.getState(), 'open');
});
test('probe leases recover hung probes and fence late completions', async () => {
  const clock = fakeClock();
  const circuit = createCircuitBreaker({
    clock,
    store: new MemoryStore(),
    failureThreshold: 1,
    resetTimeout: 10,
    probeTimeout: 20,
  });
  await rejects(() => circuit.execute(fail), 'Error');
  clock.advance(10);
  let release!: () => void;
  const pending = circuit.execute(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  clock.advance(20);
  await rejects(() => circuit.execute(fail), 'Error');
  release();
  await pending;
  equal(await circuit.getState(), 'open');
});
test('policy rejections release a probe without counting as recovery or failure', async () => {
  const clock = fakeClock();
  const circuit = createCircuitBreaker({
    clock,
    store: new MemoryStore(),
    failureThreshold: 1,
    resetTimeout: 10,
    successThreshold: 2,
  });
  await rejects(() => circuit.execute(fail), 'Error');
  clock.advance(10);
  await rejects(
    () =>
      circuit.execute(() => {
        throw new RateLimitError(1, 'key');
      }),
    'RateLimitError',
  );
  equal(await circuit.getState(), 'half-open');
  await circuit.execute(() => 1);
  equal(await circuit.getState(), 'half-open');
  await circuit.execute(() => 1);
  equal(await circuit.getState(), 'closed');
});
test('consecutive circuit failures reset on success and timeouts count as failures', async () => {
  const circuit = createCircuitBreaker({
    store: new MemoryStore(),
    failureThreshold: 2,
  });
  await rejects(() => circuit.execute(fail), 'Error');
  await circuit.execute(() => 1);
  await rejects(() => circuit.execute(fail), 'Error');
  equal(await circuit.getState(), 'closed');
  await rejects(
    () => circuit.execute(() => new Promise(() => {}), { timeout: 5 }),
    'TimeoutError',
  );
  equal(await circuit.getState(), 'open');
});
