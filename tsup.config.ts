import { defineConfig } from 'tsup';
import { resolve } from 'node:path';

const shared = {
  entry: [
    'src/index.ts',
    'src/retry.ts',
    'src/rate-limit.ts',
    'src/circuit-breaker.ts',
    'src/persistence.ts',
    'src/telemetry.ts',
    'src/adapters/memory.ts',
    'src/adapters/sqlite.ts',
    'src/adapters/redis.ts',
  ],
  target: 'es2022' as const,
  splitting: true,
  sourcemap: true,
  clean: true,
  external: [
    'node:sqlite',
    'bun:sqlite',
    'better-sqlite3',
    '@opentelemetry/api',
  ],
};

export default defineConfig([
  { ...shared, format: ['esm', 'cjs'], platform: 'neutral', dts: true },
  {
    ...shared,
    format: ['esm'],
    platform: 'browser',
    outDir: 'dist/browser',
    esbuildPlugins: [
      {
        name: 'edge-optional-imports',
        setup(build) {
          build.onResolve({ filter: /(^|\/)optional-import$/ }, () => ({
            path: resolve('src/optional-import.browser.ts'),
          }));
        },
      },
    ],
  },
]);
