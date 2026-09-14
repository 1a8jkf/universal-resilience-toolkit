import {
  withResilience,
  retry,
  createRateLimiter,
  createCircuitBreaker,
  createResilience,
  MemoryStore,
} from '@1a8jkf/universal-resilience-toolkit';
import type {
  ResilienceOptions,
  Tracer,
} from '@1a8jkf/universal-resilience-toolkit';
import { trace } from '@opentelemetry/api';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
const wrapped = withResilience(async (id: number, label?: string) => ({
  id,
  label,
}));
export type Args = Expect<
  Equal<Parameters<typeof wrapped>, [id: number, label?: string]>
>;
export type Return = Expect<
  Equal<
    ReturnType<typeof wrapped>,
    Promise<{ id: number; label: string | undefined }>
  >
>;
const sync = withResilience((value: string) => value.length);
export type Sync = Expect<Equal<ReturnType<typeof sync>, Promise<number>>>;
const tuple = withResilience((...values: [string, number]) => values);
export type Tuple = Expect<
  Equal<Awaited<ReturnType<typeof tuple>>, [string, number]>
>;
const method = withResilience(function (
  this: { prefix: string },
  suffix: string,
) {
  return this.prefix + suffix;
});
method.call({ prefix: 'x' }, 'y');
// @ts-expect-error Incorrect receiver type.
method.call({ prefix: 1 }, 'y');
// @ts-expect-error Argument types must not be widened.
wrapped('wrong');
// @ts-expect-error Missing required argument.
wrapped.execute([]);
// @ts-expect-error Duration strings require explicit units.
const invalid: ResilienceOptions = { timeout: 'forever' };
void invalid;
createRateLimiter({
  tokensPerInterval: 1,
  interval: '1s',
  // @ts-expect-error Only supported algorithms are accepted.
  algorithm: 'fixed-window',
});
const retried = retry(({ attempt, signal }) => ({
  attempt,
  aborted: signal.aborted,
}));
export type RetryReturn = Expect<
  Equal<typeof retried, Promise<{ attempt: number; aborted: boolean }>>
>;
const limited = createRateLimiter({
  tokensPerInterval: 10,
  interval: '1s',
  store: new MemoryStore(),
}).execute(() => 42);
export type Limited = Expect<Equal<typeof limited, Promise<number>>>;
const broken = createCircuitBreaker({
  persistence: { mode: 'memory' },
}).execute(async () => 'ok');
export type Broken = Expect<Equal<typeof broken, Promise<string>>>;
const composed = createResilience(({ attempt }) => attempt).execute();
export type Composed = Expect<Equal<typeof composed, Promise<number>>>;
const tracer: Tracer = trace.getTracer('consumer');
void tracer;
