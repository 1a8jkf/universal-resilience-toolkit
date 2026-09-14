export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h'}`;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Update<T, R> {
  state: T | undefined;
  value: R;
}

/** Reducers must be synchronous and pure: optimistic stores can replay them. */
export interface StateStore {
  readonly kind: 'memory' | 'sqlite' | 'redis';
  update<T extends JsonValue, R>(
    key: string,
    reducer: (state: T | undefined) => Update<T, R>,
  ): Promise<R>;
  close?(): void | Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface OperationContext {
  /** One-based attempt number. */
  attempt: number;
  signal: AbortSignal;
}

export type Operation<T> = (context: OperationContext) => T | PromiseLike<T>;

export interface ExecutionOptions {
  signal?: AbortSignal;
  /** Per-attempt timeout, not a total retry deadline. */
  timeout?: Duration;
}

export interface PolicyEnvironment {
  clock?: Clock;
}
