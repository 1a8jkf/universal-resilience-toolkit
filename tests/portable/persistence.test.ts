import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';
import {
  createPersistence,
  detectRuntime,
} from '@1a8jkf/universal-resilience-toolkit/persistence';
import { createRateLimiter } from '@1a8jkf/universal-resilience-toolkit/rate-limit';
import { retry } from '@1a8jkf/universal-resilience-toolkit/retry';
import { RedisStore } from '@1a8jkf/universal-resilience-toolkit/adapters/redis';
import { assert, equal, rejects, test } from './harness';

test('persistence respects explicit memory and injected Redis priority', async () => {
  const redis = new RedisStore({ get: async () => null, eval: async () => 1 });
  equal((await createPersistence({ redis })).kind, 'redis');
  equal((await createPersistence({ redis, mode: 'memory' })).kind, 'memory');
  await rejects(
    () => createPersistence({ mode: 'redis' }),
    'ConfigurationError',
  );
  if (!detectRuntime().localSqliteCandidate) {
    let warned = false;
    const store = await createPersistence({
      onFallback: () => {
        warned = true;
      },
    });
    equal(store.kind, 'memory');
    assert(warned);
    await rejects(() => createPersistence({ mode: 'sqlite' }), 'StorageError');
  }
});
test('storage failures fail closed and are not retried as dependency failures', async () => {
  let calls = 0;
  let writes = 0;
  const limiter = createRateLimiter({
    tokensPerInterval: 1,
    interval: 1000,
    store: {
      kind: 'redis',
      async update() {
        writes++;
        throw new Error('backend offline');
      },
    },
  });
  await rejects(
    () =>
      retry(() =>
        limiter.execute(() => {
          calls++;
        }),
      ),
    'StorageError',
  );
  equal(calls, 0);
  equal(writes, 1);
});
test('memory reducers operate on detached state and preserve values after exceptions', async () => {
  const store = new MemoryStore();
  await store.update<{ value: number }, void>('test', () => ({
    state: { value: 1 },
    value: undefined,
  }));
  await rejects(
    () =>
      store.update<{ value: number }, void>('test', (state) => {
        assert(state);
        state.value = 2;
        throw new Error('rollback');
      }),
    'Error',
  );
  equal(
    await store.update<{ value: number }, number>('test', (state) => ({
      state,
      value: state?.value ?? 0,
    })),
    1,
  );
  await store.update('test', () => ({ state: undefined, value: undefined }));
  equal(store.size, 0);
  store.close();
  await rejects(
    () => store.update('test', () => ({ state: null, value: null })),
    'StorageError',
  );
});
test('Redis CAS retries contention and rejects malformed server results', async () => {
  let writes = 0;
  const store = new RedisStore({
    get: async () => '1',
    eval: async () => (++writes === 1 ? 0 : 1),
  });
  equal(
    await store.update<number, number>('test', (state) => ({
      state: (state ?? 0) + 1,
      value: state ?? 0,
    })),
    1,
  );
  equal(writes, 2);
  const invalid = new RedisStore({
    get: async () => null,
    eval: async () => null,
  });
  await rejects(
    () => invalid.update('x', () => ({ state: 1, value: 1 })),
    'StorageError',
  );
  const busy = new RedisStore(
    { get: async () => null, eval: async () => 0 },
    { maxContentionRetries: 2 },
  );
  await rejects(
    () => busy.update('x', () => ({ state: 1, value: 1 })),
    'StorageError',
  );
});
