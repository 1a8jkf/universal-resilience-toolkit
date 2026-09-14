import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { RedisStore } from '../dist/adapters/redis.js';
import { createRateLimiter, createCircuitBreaker } from '../dist/index.js';

test(
  'real Redis: Lua atomicity, shared limits, circuit recovery, and connection failure',
  { timeout: 60_000 },
  async () => {
    assert.ok(
      process.env.REDIS_URL,
      'Set REDIS_URL to run the real Redis integration suite.',
    );
    const clients = [
      createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 3000, reconnectStrategy: false },
      }),
      createClient({
        url: process.env.REDIS_URL,
        socket: { connectTimeout: 3000, reconnectStrategy: false },
      }),
    ];
    clients.forEach((client) => client.on('error', () => {}));
    const prefix = `resilience-test:${randomUUID()}:`;
    const stores = clients.map(
      (client) =>
        new RedisStore(
          {
            get: (key) => client.get(key),
            eval: (script, keys, args) =>
              client.eval(script, { keys, arguments: args }),
          },
          { prefix },
        ),
    );
    let now = 1000;
    const clock = { now: () => now, sleep: async () => {} };
    try {
      await Promise.all(clients.map((client) => client.connect()));
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          stores[i % 2].update('counter', (state) => ({
            state: (state ?? 0) + 1,
            value: null,
          })),
        ),
      );
      assert.equal(
        await stores[0].update('counter', (state) => ({ state, value: state })),
        100,
      );
      for (const algorithm of ['token-bucket', 'sliding-window']) {
        const limiters = stores.map((store) =>
          createRateLimiter({
            store,
            key: algorithm,
            tokensPerInterval: 10,
            interval: 1000,
            algorithm,
            clock,
          }),
        );
        const results = await Promise.allSettled(
          Array.from({ length: 100 }, (_, i) => limiters[i % 2].acquire()),
        );
        assert.equal(
          results.filter((r) => r.status === 'fulfilled').length,
          10,
        );
      }
      const circuits = stores.map((store) =>
        createCircuitBreaker({
          store,
          key: 'shared',
          failureThreshold: 1,
          resetTimeout: 10,
          clock,
        }),
      );
      await assert.rejects(
        circuits[0].execute(() => {
          throw new Error('failed');
        }),
      );
      assert.equal(await circuits[1].getState(), 'open');
      await assert.rejects(
        circuits[1].execute(() => 1),
        { name: 'CircuitOpenError' },
      );
      now += 10;
      let release;
      let entered;
      const ready = new Promise((resolve) => {
        entered = resolve;
      });
      const probe = circuits[0].execute(
        () =>
          new Promise((resolve) => {
            release = resolve;
            entered();
          }),
      );
      await ready;
      await assert.rejects(
        circuits[1].execute(() => 1),
        { name: 'CircuitOpenError' },
      );
      release(42);
      await probe;
      assert.equal(await circuits[1].getState(), 'closed');
      await stores[0].update('counter', () => ({
        state: undefined,
        value: null,
      }));
      assert.equal(await clients[0].get(prefix + 'counter'), null);
    } finally {
      try {
        if (clients[0].isReady) {
          const keys = await clients[0].keys(prefix + '*');
          if (keys.length) await clients[0].del(keys);
        }
      } finally {
        for (const client of clients) if (client.isOpen) client.destroy();
      }
    }
    await assert.rejects(
      stores[0].update('closed', () => ({ state: 1, value: 1 })),
      { name: 'StorageError' },
    );
  },
);
