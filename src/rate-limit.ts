import { ConfigurationError, RateLimitError } from './errors';
import { lazyPersistence, policyKey, updateState } from './persistence';
import type { PersistenceOptions } from './persistence';
import { emitSpan } from './telemetry';
import type { TelemetryOptions } from './telemetry';
import {
  durationMs,
  positiveInteger,
  runAttempt,
  systemClock,
  throwIfAborted,
} from './time';
import type {
  Duration,
  ExecutionOptions,
  Operation,
  PolicyEnvironment,
  StateStore,
} from './types';

export interface RateLimitOptions extends PolicyEnvironment {
  tokensPerInterval: number;
  interval: Duration;
  algorithm?: 'token-bucket' | 'sliding-window';
  /** Token-bucket burst capacity, defaulting to tokensPerInterval. */
  capacity?: number;
  key?: string;
  store?: StateStore;
  persistence?: PersistenceOptions;
  telemetry?: TelemetryOptions;
}
type Bucket = { config: string; tokens: number; updatedAt: number };
type Window = { config: string; timestamps: number[]; updatedAt: number };

export function createRateLimiter(options: RateLimitOptions) {
  const limit = positiveInteger(options.tokensPerInterval, 'tokensPerInterval');
  const interval = durationMs(options.interval, 'interval');
  const capacity = positiveInteger(options.capacity ?? limit, 'capacity');
  const algorithm = options.algorithm ?? 'token-bucket';
  if (!['token-bucket', 'sliding-window'].includes(algorithm))
    throw new ConfigurationError('Invalid rate limit algorithm.');
  if (algorithm === 'sliding-window' && options.capacity !== undefined)
    throw new ConfigurationError('capacity applies only to token buckets.');
  const key = policyKey('rate', options.key);
  const config = JSON.stringify([1, algorithm, limit, interval, capacity]);
  const store = options.store ?? lazyPersistence(options.persistence);
  const clock = options.clock ?? systemClock;

  async function acquire(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const timestamp = clock.now();
    const wait =
      algorithm === 'token-bucket'
        ? await updateState<Bucket, number>(store, key, (previous) => {
            if (previous && previous.config !== config)
              throw new ConfigurationError(
                `Conflicting rate limit configuration for key "${key}".`,
              );
            const now = Math.max(timestamp, previous?.updatedAt ?? timestamp);
            const tokens = Math.min(
              capacity,
              (previous?.tokens ?? capacity) +
                ((now - (previous?.updatedAt ?? now)) * limit) / interval,
            );
            const allowed = tokens >= 1;
            return {
              state: {
                config,
                tokens: allowed ? tokens - 1 : tokens,
                updatedAt: now,
              },
              value: allowed ? 0 : ((1 - tokens) * interval) / limit,
            };
          })
        : await updateState<Window, number>(store, key, (previous) => {
            if (previous && previous.config !== config)
              throw new ConfigurationError(
                `Conflicting rate limit configuration for key "${key}".`,
              );
            const now = Math.max(timestamp, previous?.updatedAt ?? timestamp);
            const timestamps = (previous?.timestamps ?? []).filter(
              (time) => time > now - interval,
            );
            const allowed = timestamps.length < limit;
            const wait = allowed
              ? 0
              : Math.max(0, (timestamps[0] ?? now) + interval - now);
            if (allowed) timestamps.push(now);
            return {
              state: { config, timestamps, updatedAt: now },
              value: wait,
            };
          });
    if (wait > 0) {
      await emitSpan(
        'resilience.rate_limit.rejected',
        {
          'rate_limit.key': key,
          'rate_limit.algorithm': algorithm,
          'rate_limit.retry_after_ms': wait,
        },
        options.telemetry,
      );
      throw new RateLimitError(wait, key);
    }
    throwIfAborted(signal);
  }

  return {
    acquire,
    async execute<T>(
      operation: Operation<T>,
      execution: ExecutionOptions = {},
    ): Promise<T> {
      await acquire(execution.signal);
      return runAttempt(operation, 1, execution);
    },
    async close(): Promise<void> {
      if (!options.store) await store.close?.();
    },
  };
}

export { RateLimitError } from './errors';
