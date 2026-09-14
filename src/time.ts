import { AbortError, ConfigurationError, TimeoutError } from './errors';
import type { Clock, Duration, ExecutionOptions, Operation } from './types';

const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
export function durationMs(
  value: Duration,
  label = 'duration',
  allowZero = false,
): number {
  const match =
    typeof value === 'string'
      ? /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value)
      : null;
  const result =
    typeof value === 'number'
      ? value
      : match
        ? Number(match[1]) * units[match[2] as keyof typeof units]
        : NaN;
  if (
    !Number.isFinite(result) ||
    result < 0 ||
    (!allowZero && result === 0) ||
    result > 2_147_483_647
  ) {
    throw new ConfigurationError(
      `${label} must be a ${allowZero ? 'non-negative' : 'positive'} duration no greater than 2147483647ms.`,
    );
  }
  return result;
}

export function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new ConfigurationError(`${label} must be a positive safe integer.`);
  return value;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError(signal.reason);
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError(signal.reason));
        return;
      }
      const finish = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new AbortError(signal?.reason));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  },
};

/** Timers are real wall timers; policy clocks can be independently injected. */
export async function runAttempt<T>(
  operation: Operation<T>,
  attempt: number,
  options: ExecutionOptions = {},
): Promise<T> {
  throwIfAborted(options.signal);
  const timeoutMs =
    options.timeout === undefined
      ? undefined
      : durationMs(options.timeout, 'timeout');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const interrupt = (error: Error) => {
      reject(error);
      controller.abort(error);
    };
    abort = () => interrupt(new AbortError(options.signal?.reason));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (timeoutMs !== undefined)
      timer = setTimeout(
        () => interrupt(new TimeoutError(timeoutMs)),
        timeoutMs,
      );
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        throwIfAborted(controller.signal);
        return operation({ attempt, signal: controller.signal });
      }),
      interrupted,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener('abort', abort);
  }
}
