import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../dist/adapters/sqlite.js';

const directory = await mkdtemp(join(tmpdir(), 'resilience-sqlite-'));
const filename = join(directory, 'state.sqlite');
let store;
try {
  store = await createSqliteStore(filename);
  await store.update('key', () => ({ state: 42, value: null }));
  store.close();
  store = await createSqliteStore(filename);
  assert.equal(
    await store.update('key', (state) => ({ state, value: state })),
    42,
  );
  console.log('Native SQLite persistence and reopen passed.');
} finally {
  store?.close();
  await rm(directory, { recursive: true, force: true });
}
