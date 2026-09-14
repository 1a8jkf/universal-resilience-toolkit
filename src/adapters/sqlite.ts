import { StorageError } from '../errors';
import { optionalImport } from '../optional-import';
import type { JsonValue, StateStore, Update } from '../types';

export interface SqliteStatement {
  get(...parameters: (string | number)[]): unknown;
  run(...parameters: (string | number)[]): unknown;
  finalize?(): void;
}
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/** A connection belongs exclusively to this adapter while it is open. */
export class SqliteStore implements StateStore {
  readonly kind = 'sqlite' as const;
  private closed = false;
  constructor(private readonly database: SqliteDatabase) {
    database.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS resilience_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }

  async update<T extends JsonValue, R>(
    key: string,
    reducer: (state: T | undefined) => Update<T, R>,
  ): Promise<R> {
    if (this.closed) throw new StorageError('SQLite store is closed.');
    let began = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      began = true;
      const row = this.statement(
        'SELECT value FROM resilience_state WHERE key = ?',
        'get',
        [key],
      ) as { value: string } | undefined;
      const result = reducer(row ? (JSON.parse(row.value) as T) : undefined);
      if (result.state === undefined)
        this.statement('DELETE FROM resilience_state WHERE key = ?', 'run', [
          key,
        ]);
      else
        this.statement(
          'INSERT INTO resilience_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'run',
          [key, JSON.stringify(result.state)],
        );
      this.database.exec('COMMIT');
      return result.value;
    } catch (error) {
      if (began) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          /* Preserve the original failure. */
        }
      }
      throw error;
    }
  }
  private statement(
    sql: string,
    method: 'get' | 'run',
    parameters: (string | number)[],
  ): unknown {
    const statement = this.database.prepare(sql);
    try {
      return statement[method](...parameters);
    } finally {
      statement.finalize?.();
    }
  }
  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}

type DatabaseConstructor = new (filename: string) => SqliteDatabase;
type Driver = {
  DatabaseSync?: DatabaseConstructor;
  Database?: DatabaseConstructor;
  default?: DatabaseConstructor;
};

export async function createSqliteStore(
  filename = '.resilience-toolkit.sqlite',
): Promise<SqliteStore> {
  const root = globalThis as typeof globalThis & { Bun?: { file?: unknown } };
  const drivers =
    typeof root.Bun?.file === 'function'
      ? ['bun:sqlite']
      : ['node:sqlite', 'better-sqlite3'];
  const failures: unknown[] = [];
  for (const specifier of drivers) {
    let database: SqliteDatabase | undefined;
    try {
      const driver = (await optionalImport(specifier)) as Driver;
      const Constructor =
        driver.DatabaseSync ?? driver.Database ?? driver.default;
      if (!Constructor)
        throw new StorageError(
          `SQLite driver ${specifier} has no supported constructor.`,
        );
      database = new Constructor(filename);
      return new SqliteStore(database);
    } catch (error) {
      try {
        database?.close();
      } catch {
        /* Preserve driver failure. */
      }
      failures.push(error);
    }
  }
  throw new StorageError(
    'No usable SQLite driver or writable database path was found. On Node 18/20, install the optional better-sqlite3 peer.',
    { cause: new AggregateError(failures) },
  );
}
