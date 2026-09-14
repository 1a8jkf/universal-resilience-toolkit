import { ConfigurationError, isPolicyRejection } from './errors';
import { finishSpan, startSpan } from './telemetry';
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
} from './types';

export interface RetryOptions extends PolicyEnvironment {
  maxAttempts?: number;
  backoff?: 'exponential' | 'constant';
  initialDelay?: Duration;
  maxDelay?: Duration;
  factor?: number;
  jitter?: 'full' | 'equal' | 'none';
  random?: () => number;
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  telemetry?: TelemetryOptions;
}

export function createRetry(options: RetryOptions = {}) {
  const attempts = positiveInteger(options.maxAttempts ?? 3, 'maxAttempts');
  const initial = durationMs(options.initialDelay ?? 100, 'initialDelay', true);
  const maximum = durationMs(options.maxDelay ?? '30s', 'maxDelay', true);
  const factor = options.factor ?? 2;
  if (!Number.isFinite(factor) || factor < 1)
    throw new ConfigurationError('factor must be finite and at least 1.');
  if (
    options.backoff !== undefined &&
    !['constant', 'exponential'].includes(options.backoff)
  )
    throw new ConfigurationError('Invalid backoff strategy.');
  if (
    options.jitter !== undefined &&
    !['full', 'equal', 'none'].includes(options.jitter)
  )
    throw new ConfigurationError('Invalid jitter strategy.');
  const clock = options.clock ?? systemClock;

  return {
    async execute<T>(
      operation: Operation<T>,
      execution: ExecutionOptions = {},
    ): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        throwIfAborted(execution.signal);
        const span = await startSpan(
          'resilience.retry.attempt',
          { 'retry.attempt': attempt, 'retry.max_attempts': attempts },
          options.telemetry,
        );
        try {
          const result = await runAttempt(operation, attempt, execution);
          finishSpan(span);
          return result;
        } catch (error) {
          finishSpan(span, error);
          throwIfAborted(execution.signal);
          if (
            attempt >= attempts ||
            isPolicyRejection(error) ||
            (options.shouldRetry &&
              !(await options.shouldRetry(error, attempt)))
          )
            throw error;
          let delay =
            initial === 0
              ? 0
              : Math.min(
                  maximum,
                  initial *
                    (options.backoff === 'constant'
                      ? 1
                      : factor ** (attempt - 1)),
                );
          if (options.jitter !== 'none') {
            const random = (options.random ?? Math.random)();
            if (!Number.isFinite(random) || random < 0 || random >= 1)
              throw new ConfigurationError(
                'random must return a finite number in [0, 1).',
              );
            delay *= options.jitter === 'equal' ? (1 + random) / 2 : random;
          }
          await clock.sleep(delay, execution.signal);
        }
      }
    },
  };
}

export function retry<T>(
  operation: Operation<T>,
  options?: RetryOptions,
  execution?: ExecutionOptions,
): Promise<T> {
  return createRetry(options).execute(operation, execution);
}

export { AbortError, TimeoutError, ConfigurationError } from './errors';
export type {
  Duration,
  ExecutionOptions,
  Operation,
  OperationContext,
  Clock,
} from './types';
