import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const runtime = process.argv[2] ?? 'node';
await mkdir('.test-build', { recursive: true });
const suiteImport = "import { runSuite } from './tests/portable/suite.ts';";
const report = (result) => {
  for (const item of result.results)
    console.log(
      `${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`,
    );
  console.log(`${runtime}: ${result.passed}/${result.total} passed`);
  if (!result.total || result.passed !== result.total) process.exitCode = 1;
};

if (runtime === 'workers') {
  const { Miniflare } = await import('miniflare');
  const outfile = '.test-build/worker.mjs';
  await build({
    stdin: {
      contents: `${suiteImport} export default { async fetch() { return Response.json(await runSuite()); } };`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile,
    ignoreAnnotations: true,
  });
  const worker = new Miniflare({
    modules: true,
    scriptPath: outfile,
    compatibilityDate: '2025-03-01',
  });
  try {
    report(await (await worker.dispatchFetch('http://localhost/')).json());
  } finally {
    await worker.dispose();
  }
} else if (runtime === 'edge') {
  const { EdgeVM } = await import('@edge-runtime/vm');
  const result = await build({
    stdin: {
      contents: `${suiteImport} globalThis.suiteResult = runSuite();`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    ignoreAnnotations: true,
  });
  const vm = new EdgeVM();
  vm.evaluate(result.outputFiles[0].text);
  report(await vm.context.suiteResult);
} else if (['node', 'bun', 'deno'].includes(runtime)) {
  const outfile = `.test-build/${runtime}.mjs`;
  await build({
    stdin: {
      contents: `${suiteImport} console.log(JSON.stringify(await runSuite()));`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    ignoreAnnotations: true,
  });
  // Bun and Deno paths can be supplied by local/CI runtime installers.
  const executable = process.env[`${runtime.toUpperCase()}_BIN`] ?? runtime;
  const args =
    runtime === 'deno'
      ? ['run', '--allow-env', '--allow-read', outfile]
      : [outfile];
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `Runtime exited ${result.status}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  await writeFile(
    `.test-build/${runtime}-results.json`,
    JSON.stringify(parsed, null, 2),
  );
  report(parsed);
} else throw new Error(`Unknown runtime: ${runtime}`);
