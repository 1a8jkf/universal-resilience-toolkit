import { StorageError } from '../errors';
import type { JsonValue, StateStore, Update } from '../types';

/** Atomic within one JS isolate. Share the same instance to share state. */
export class MemoryStore implements StateStore {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, string>();
  private closed = false;

  async update<T extends JsonValue, R>(
    key: string,
    reducer: (state: T | undefined) => Update<T, R>,
  ): Promise<R> {
    if (this.closed) throw new StorageError('Memory store is closed.');
    const encoded = this.data.get(key);
    const result = reducer(
      encoded === undefined ? undefined : (JSON.parse(encoded) as T),
    );
    if (result.state === undefined) this.data.delete(key);
    else this.data.set(key, JSON.stringify(result.state));
    return result.value;
  }

  get size(): number {
    return this.data.size;
  }
  close(): void {
    this.closed = true;
    this.data.clear();
  }
}
