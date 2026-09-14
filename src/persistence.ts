import { MemoryStore } from './adapters/memory';
import { ConfigurationError, StorageError } from './errors';
import type { JsonValue, StateStore, Update } from './types';

export interface PersistenceOptions {
  mode?: 'auto' | 'memory' | 'sqlite' | 'redis';
  /** Redis injection takes precedence in automatic mode. Explicit modes take precedence over injection. */
  redis?: StateStore;
  sqlitePath?: string;
  /** Called only when automatic selection falls back to memory. Opt in in development. */
  onFallback?: (error: Error) => void;
}

export interface RuntimeCapabilities {
  node: boolean;
  bun: boolean;
  deno: boolean;
  edge: boolean;
  localSqliteCandidate: boolean;
}
export function detectRuntime(): RuntimeCapabilities {
  const root = globalThis as typeof globalThis & {
    Bun?: { file?: unknown };
    Deno?: { version?: unknown };
    EdgeRuntime?: unknown;
    WebSocketPair?: unknown;
    process?: { versions?: { node?: unknown }; getBuiltinModule?: unknown };
  };
  const bun = typeof root.Bun?.file === 'function';
  const deno = root.Deno?.version !== undefined;
  const edge =
    typeof root.EdgeRuntime === 'string' ||
    typeof root.WebSocketPair === 'function';
  const node =
    !bun && !deno && !edge && typeof root.process?.versions?.node === 'string';
  return {
    node,
    bun,
    deno,
    edge,
    localSqliteCandidate: !edge && !deno && (node || bun),
  };
}

export async function createPersistence(
  options: PersistenceOptions = {},
): Promise<StateStore> {
  const mode = options.mode ?? 'auto';
  if (!['auto', 'memory', 'sqlite', 'redis'].includes(mode))
    throw new ConfigurationError('Invalid persistence mode.');
  if (mode === 'memory') return new MemoryStore();
  if (mode === 'redis' || (mode === 'auto' && options.redis)) {
    if (options.redis?.kind !== 'redis')
      throw new ConfigurationError(
        'Redis persistence requires an injected Redis adapter.',
      );
    return options.redis;
  }
  let failure: Error = new StorageError(
    'Local SQLite is unavailable in this runtime.',
  );
  if (mode === 'sqlite' || detectRuntime().localSqliteCandidate) {
    try {
      const { createSqliteStore } = await import('./adapters/sqlite');
      return await createSqliteStore(options.sqlitePath);
    } catch (error) {
      failure = new StorageError('Unable to open local SQLite persistence.', {
        cause: error,
      });
      if (mode === 'sqlite') throw failure;
    }
  }
  try {
    options.onFallback?.(failure);
  } catch {
    /* A diagnostic callback cannot break automatic fallback. */
  }
  return new MemoryStore();
}

/** Lazily initialized; constructing a wrapper never opens a file. */
export function lazyPersistence(options?: PersistenceOptions): StateStore {
  let selected: Promise<StateStore> | undefined;
  let kind: StateStore['kind'] = 'memory';
  let closed = false;
  return {
    get kind() {
      return kind;
    },
    async update<T extends JsonValue, R>(
      key: string,
      reducer: (state: T | undefined) => Update<T, R>,
    ): Promise<R> {
      if (closed) throw new StorageError('Persistence handle is closed.');
      selected ??= createPersistence(options);
      const store = await selected;
      kind = store.kind;
      return store.update(key, reducer);
    },
    async close() {
      closed = true;
      if (selected) {
        const store = await selected;
        if (store !== options?.redis) await store.close?.();
      }
    },
  };
}

let counter = 0;
export function policyKey(kind: string, key?: string): string {
  if (key !== undefined && key.length === 0)
    throw new ConfigurationError('State key must not be empty.');
  return `${kind}:${key ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}-${++counter}`}`;
}

export async function updateState<T extends JsonValue, R>(
  store: StateStore,
  key: string,
  reducer: (state: T | undefined) => Update<T, R>,
): Promise<R> {
  try {
    return await store.update(key, reducer);
  } catch (error) {
    if (error instanceof StorageError || error instanceof ConfigurationError)
      throw error;
    throw new StorageError(`State update failed for key "${key}".`, {
      cause: error,
    });
  }
}

export type { StateStore, JsonValue, Update } from './types';
