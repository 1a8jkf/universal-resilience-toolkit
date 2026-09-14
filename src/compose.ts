import { createCircuitBreaker } from './circuit-breaker';
import type { CircuitBreakerOptions } from './circuit-breaker';
import { lazyPersistence } from './persistence';
import type { PersistenceOptions } from './persistence';
import { createRateLimiter } from './rate-limit';
import type { RateLimitOptions } from './rate-limit';
import { createRetry } from './retry';
import type { RetryOptions } from './retry';
import type { TelemetryOptions } from './telemetry';
import { durationMs, runAttempt } from './time';
import type {
  Duration,
  ExecutionOptions,
  Operation,
  StateStore,
} from './types';

export interface ResilienceOptions {
  retry?: RetryOptions;
  rateLimit?: RateLimitOptions;
  circuitBreaker?: CircuitBreakerOptions;
  persistence?: PersistenceOptions;
  store?: StateStore;
  key?: string;
  timeout?: Duration;
  telemetry?: TelemetryOptions;
}

export interface ResilientFunction<This, Args extends unknown[], Result> {
  (this: This, ...args: Args): Promise<Awaited<Result>>;
  /** Bind receiver-dependent functions before using execute. */
  execute(args: Args, options?: ExecutionOptions): Promise<Awaited<Result>>;
  close(): Promise<void>;
}

function createEngine(options: ResilienceOptions) {
  if (options.timeout !== undefined) durationMs(options.timeout, 'timeout');
  const store = options.store ?? lazyPersistence(options.persistence);
  const shared = {
    store,
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.telemetry === undefined
      ? {}
      : { telemetry: options.telemetry }),
  };
  const retryPolicy = createRetry({
    maxAttempts: options.retry ? 3 : 1,
    ...options.retry,
    ...(options.telemetry === undefined || options.retry?.telemetry
      ? {}
      : { telemetry: options.telemetry }),
  });
  const rateOptions: RateLimitOptions | undefined = options.rateLimit
    ? { ...shared, ...options.rateLimit }
    : undefined;
  const circuitOptions: CircuitBreakerOptions | undefined =
    options.circuitBreaker
      ? { ...shared, ...options.circuitBreaker }
      : undefined;
  if (rateOptions && options.rateLimit?.persistence && !options.rateLimit.store)
    delete rateOptions.store;
  if (
    circuitOptions &&
    options.circuitBreaker?.persistence &&
    !options.circuitBreaker.store
  )
    delete circuitOptions.store;
  const rate = rateOptions ? createRateLimiter(rateOptions) : undefined;
  const circuit = circuitOptions
    ? createCircuitBreaker(circuitOptions)
    : undefined;
  return {
    async execute<T>(
      operation: Operation<T>,
      execution: ExecutionOptions = {},
    ): Promise<T> {
      const timeout = execution.timeout ?? options.timeout;
      if (timeout !== undefined) durationMs(timeout, 'timeout');
      return retryPolicy.execute(
        ({ attempt, signal }) => {
          const invoke: Operation<T> = async (context) => {
            await rate?.acquire(context.signal);
            return runAttempt(operation, attempt, {
              signal: context.signal,
              ...(timeout === undefined ? {} : { timeout }),
            });
          };
          return circuit
            ? circuit.execute(invoke, { signal })
            : invoke({ attempt, signal });
        },
        execution.signal === undefined ? {} : { signal: execution.signal },
      );
    },
    async close(): Promise<void> {
      await rate?.close();
      await circuit?.close();
      if (!options.store) await store.close?.();
    },
  };
}

/** Context-aware execution for cooperative cancellation and per-call signals. */
export function createResilience<T>(
  operation: Operation<T>,
  options: ResilienceOptions = {},
) {
  const engine = createEngine(options);
  return {
    execute: (execution?: ExecutionOptions) =>
      engine.execute(operation, execution),
    close: engine.close,
  };
}

export function withResilience<This, Args extends unknown[], Result>(
  operation: (this: This, ...args: Args) => Result,
  options: ResilienceOptions = {},
): ResilientFunction<This, Args, Result> {
  const engine = createEngine(options);
  const invoke = (receiver: This, args: Args, execution: ExecutionOptions) =>
    engine.execute<Awaited<Result>>(
      () => Promise.resolve(operation.apply(receiver, args)),
      execution,
    );
  const wrapped = async function (
    this: This,
    ...args: Args
  ): Promise<Awaited<Result>> {
    return invoke(this, args, {});
  };
  wrapped.execute = (args: Args, execution: ExecutionOptions = {}) =>
    invoke(undefined as This, args, execution);
  wrapped.close = engine.close;
  return wrapped;
}
