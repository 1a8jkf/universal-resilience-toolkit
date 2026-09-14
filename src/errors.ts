export class ResilienceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RateLimitError extends ResilienceError {
  constructor(
    public readonly retryAfterMs: number,
    public readonly key: string,
  ) {
    super(
      `Rate limit exceeded for key "${key}"; retry in ${Math.ceil(retryAfterMs)}ms.`,
    );
  }
}

export class CircuitOpenError extends ResilienceError {
  constructor(
    public readonly retryAfterMs: number,
    public readonly key: string,
  ) {
    super(
      `Circuit is open for key "${key}"; retry in ${Math.ceil(retryAfterMs)}ms.`,
    );
  }
}

export class StorageError extends ResilienceError {}
export class ConfigurationError extends ResilienceError {}
export class TimeoutError extends ResilienceError {
  constructor(public readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms.`);
  }
}
export class AbortError extends ResilienceError {
  constructor(reason?: unknown) {
    super('Operation aborted.', { cause: reason });
  }
}

export function isPolicyRejection(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof CircuitOpenError ||
    error instanceof StorageError ||
    error instanceof AbortError ||
    error instanceof ConfigurationError
  );
}
