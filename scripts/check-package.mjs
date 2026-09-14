import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
const require = createRequire(import.meta.url);
for (const [entry, map] of Object.entries(manifest.exports)) {
  if (typeof map !== 'object') continue;
  const specifier = manifest.name + (entry === '.' ? '' : entry.slice(1));
  assert.ok(
    Object.keys(await import(specifier)).length,
    `Empty ESM export: ${specifier}`,
  );
  assert.ok(
    Object.keys(require(specifier)).length,
    `Empty CJS export: ${specifier}`,
  );
  for (const target of [
    map.import.types,
    map.require.types,
    map.browser.default,
  ])
    await readFile(target);
}

for (const entry of [manifest.name, `${manifest.name}/retry`]) {
  const bundle = await build({
    stdin: {
      contents: `import { retry } from '${entry}'; globalThis.retry = retry;`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    minify: true,
  });
  const text = bundle.outputFiles[0].text;
  assert.ok(
    !text.includes('resilience.circuit.transition'),
    'Retry-only bundle retains circuit breaker code.',
  );
  assert.ok(
    !text.includes('resilience.rate_limit.rejected'),
    'Retry-only bundle retains rate limiter code.',
  );
  assert.ok(
    !text.includes('BEGIN IMMEDIATE'),
    'Retry-only bundle retains SQLite implementation.',
  );
  assert.ok(
    !/import\(/.test(text),
    'Browser retry bundle contains an unresolved optional import.',
  );
  console.log(`Tree shaking: ${entry}: ${text.length} bytes`);
}

const edgeBundle = await build({
  stdin: {
    contents: `import { withResilience } from '${manifest.name}'; globalThis.example = withResilience(() => 42, { rateLimit: { tokensPerInterval: 1, interval: 1000 } });`,
    resolveDir: process.cwd(),
  },
  platform: 'browser',
  bundle: true,
  format: 'esm',
  write: false,
});
assert.ok(
  !/import\(/.test(edgeBundle.outputFiles[0].text),
  'Composed edge bundle has unresolved runtime imports.',
);

const directory = await mkdtemp(join(tmpdir(), 'resilience-consumer-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run test:package.');
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr ?? result.stdout,
  );
  return result.stdout;
}
try {
  await mkdir('.test-build/package', { recursive: true });
  const packed = JSON.parse(
    run(process.execPath, [
      npmCli,
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      '.test-build/package',
    ]),
  );
  const tarball = resolve('.test-build/package', packed[0].filename);
  assert.ok(
    packed[0].files.every(
      (file) =>
        !file.path.startsWith('tests/') && !file.path.includes('.sqlite'),
    ),
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  run(
    process.execPath,
    [
      npmCli,
      'install',
      '--ignore-scripts',
      '--omit=optional',
      '--omit=peer',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    directory,
  );
  const js = `import assert from 'node:assert/strict';
    import { retry, withResilience, createPersistence } from '${manifest.name}';
    assert.equal(await retry(() => 42), 42);
    const store = await createPersistence({ mode: 'memory' });
    assert.equal(await withResilience((a, b) => a + b, { store })(2, 3), 5);
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    assert.equal(await require('${manifest.name}').retry(() => 'ok'), 'ok');
    console.log('ESM + CJS consumer passed without optional peers');`;
  await writeFile(join(directory, 'smoke.mjs'), js);
  console.log(run(process.execPath, ['smoke.mjs'], directory).trim());
  await writeFile(
    join(directory, 'consumer.ts'),
    `import { withResilience } from '${manifest.name}'; const result: Promise<number> = withResilience((x: number) => x + 1)(2); void result;`,
  );
  run(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--strict',
      '--noEmit',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    directory,
  );
  console.log(`Packed artifact: ${tarball}`);
} finally {
  assert.ok(directory.startsWith(join(tmpdir(), 'resilience-consumer-')));
  await rm(directory, { recursive: true, force: true });
}
