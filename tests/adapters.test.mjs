import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  createPersistence,
  MemoryStore,
  createRateLimiter,
} from '../dist/index.js';
import { createSqliteStore } from '../dist/adapters/sqlite.js';
import { RedisStore } from '../dist/adapters/redis.js';

test('automatic SQLite is durable across independent connections and restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'resilience-test-'));
  const filename = join(directory, 'state.sqlite');
  let a;
  let b;
  try {
    a = await createPersistence({ sqlitePath: filename });
    assert.equal(a.kind, 'sqlite');
    b = await createSqliteStore(filename);
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        (i % 2 ? a : b).update('counter', (state) => ({
          state: (state ?? 0) + 1,
          value: null,
        })),
      ),
    );
    assert.equal(
      await b.update('counter', (state) => ({ state, value: state })),
      200,
    );
    await assert.rejects(
      a.update('counter', () => {
        throw new Error('rollback');
      }),
    );
    a.close();
    b.close();
    a = undefined;
    b = undefined;
    a = await createSqliteStore(filename);
    assert.equal(
      await a.update('counter', (state) => ({ state, value: state })),
      200,
    );
  } finally {
    a?.close();
    b?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite admission remains atomic across worker threads and connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'resilience-workers-'));
  const filename = join(directory, 'state.sqlite');
  const store = await createSqliteStore(filename);
  const options = {
    key: 'concurrent',
    tokensPerInterval: 15,
    interval: 1000,
    algorithm: 'sliding-window',
  };
  const limiter = createRateLimiter({
    ...options,
    store,
    clock: { now: () => 1000, sleep: async () => {} },
  });
  await limiter.acquire();
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createSqliteStore } = await import(workerData.adapter);
      const { createRateLimiter } = await import(workerData.main);
      const store = await createSqliteStore(workerData.filename);
      try {
        const limiter = createRateLimiter({ ...workerData.options, store, clock: { now: () => 1000, sleep: async () => {} } });
        const results = await Promise.allSettled(Array.from({ length: 30 }, () => limiter.acquire()));
        parentPort.postMessage(results.filter(r => r.status === 'fulfilled').length);
      } finally { store.close(); }
    })().catch(error => { throw error; });`;
  try {
    const counts = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise((resolve, reject) => {
            const worker = new Worker(source, {
              eval: true,
              workerData: {
                filename,
                options,
                adapter: new URL('../dist/adapters/sqlite.js', import.meta.url)
                  .href,
                main: new URL('../dist/index.js', import.meta.url).href,
              },
            });
            worker.once('message', resolve);
            worker.once('error', reject);
            worker.once('exit', (code) => {
              if (code !== 0) reject(new Error(`Worker exited ${code}`));
            });
          }),
      ),
    );
    assert.equal(
      counts.reduce((a, b) => a + b, 0),
      14,
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('automatic fallback warns once; forced SQLite and Redis never silently fall back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'resilience-fallback-'));
  const filename = join(directory, 'missing', 'state.sqlite');
  try {
    let warnings = 0;
    const store = await createPersistence({
      sqlitePath: filename,
      onFallback: () => warnings++,
    });
    assert.equal(store.kind, 'memory');
    assert.equal(warnings, 1);
    store.close();
    await assert.rejects(
      createPersistence({ mode: 'sqlite', sqlitePath: filename }),
      { name: 'StorageError' },
    );
    await assert.rejects(createPersistence({ mode: 'redis' }), {
      name: 'ConfigurationError',
    });
    await assert.rejects(createPersistence({ redis: new MemoryStore() }), {
      name: 'ConfigurationError',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Redis optimistic transactions preserve increments across independent adapters', async () => {
  const values = new Map();
  const client = {
    async get(key) {
      await Promise.resolve();
      return values.get(key) ?? null;
    },
    async eval(_script, [key], [presence, expected, operation, next]) {
      const current = values.get(key);
      if (presence === 'missing' ? current !== undefined : current !== expected)
        return 0;
      if (operation === 'delete') values.delete(key);
      else values.set(key, next);
      return 1;
    },
  };
  const a = new RedisStore(client);
  const b = new RedisStore(client);
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      (i % 2 ? a : b).update('counter', (state) => ({
        state: (state ?? 0) + 1,
        value: null,
      })),
    ),
  );
  assert.equal(
    await a.update('counter', (state) => ({ state, value: state })),
    100,
  );
});

test('installed OpenTelemetry API is discovered automatically', async () => {
  const { trace } = await import('@opentelemetry/api');
  const { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } =
    await import('@opentelemetry/sdk-trace-base');
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  try {
    const { retry } = await import('../dist/retry.js');
    assert.equal(await retry(() => 42), 42);
    await provider.forceFlush();
    assert.ok(
      exporter
        .getFinishedSpans()
        .some((span) => span.name === 'resilience.retry.attempt'),
    );
  } finally {
    trace.disable();
    await provider.shutdown();
  }
});
