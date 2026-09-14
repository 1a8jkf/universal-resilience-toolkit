# Universal Resilience Toolkit

Composable retries, rate limits, circuit breakers, and state persistence for
Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge. No mandatory runtime dependencies.

```sh
npm install @1a8jkf/universal-resilience-toolkit
```

```ts
import { withResilience } from '@1a8jkf/universal-resilience-toolkit';

const resilientFetch = withResilience(
  async (url: string) => {
    const response = await fetch(url);
    if (response.status >= 500)
      throw new Error(`Upstream HTTP ${response.status}`);
    return response;
  },
  {
    key: 'catalog-api',
    retry: { maxAttempts: 3, backoff: 'exponential' },
    rateLimit: { tokensPerInterval: 10, interval: '1s' },
    circuitBreaker: { failureThreshold: 5, resetTimeout: '30s' },
  },
);

const response = await resilientFetch('https://example.com');
```

Para instalar o pacote (como ele está no GitHub Packages), você precisa adicionar a configuração do repositório no arquivo `.npmrc` do seu projeto:

```ini
@1a8jkf:registry=https://npm.pkg.github.com
```

Você também precisará estar autenticado com um Personal Access Token com permissão de `read:packages`.

## What it combines

| Package                                              | Retry/backoff         | Rate limiting                 | Circuit breaker  | State strategy                       |
| ---------------------------------------------------- | --------------------- | ----------------------------- | ---------------- | ------------------------------------ |
| This toolkit                                         | Yes                   | Token bucket / sliding window | Yes              | Memory, local SQLite, injected Redis |
| [p-retry](https://github.com/sindresorhus/p-retry)   | Yes                   | Separate library              | Separate library | Retry scope                          |
| [Bottleneck](https://github.com/SGrondin/bottleneck) | Retry hooks           | Yes, also scheduling          | Separate library | Local or Redis clustering            |
| [Cockatiel](https://github.com/connor4312/cockatiel) | Yes                   | Separate rate policy          | Yes              | Policy-specific state                |
| [Opossum](https://github.com/nodeshift/opossum)      | Separate retry policy | Separate library              | Yes              | Circuit status import/export         |

This is a scope comparison, not a performance benchmark or a claim that the other
projects cannot be used on edge. The toolkit supplies one policy composition model
and a common behavior suite across the five runtimes. It does not include Bottleneck's
job scheduler, Cockatiel's bulkheads, or an automatic fallback response value.

## Runtime compatibility

| Runtime            | Core behavior | Default persistence                | Verification                                                             |
| ------------------ | ------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Node.js >=18       | ✅            | SQLite if usable; otherwise memory | Local Node 18 and 24; CI matrix 18, 20, 22, 24                           |
| Bun                | ✅            | Built-in SQLite when writable      | Local Bun; same suite in CI; native SQLite smoke                         |
| Deno               | ✅            | Memory                             | Local Deno; same suite in CI                                             |
| Cloudflare Workers | ✅            | Memory per isolate                 | Suite executes inside local `workerd`, also configured in CI             |
| Vercel Edge        | ✅            | Memory per isolate                 | Suite executes inside official `@edge-runtime/vm`, also configured in CI |

✅ means local execution has passed, not that a hosted deployment or GitHub Actions
run has already completed. See [verification](docs/verification.md) for exact commands
and limits. ⚠️ Memory is not shared across isolates; SQLite is not a distributed backend.
Workers tests use no Node compatibility flag.

Node's [built-in SQLite](https://nodejs.org/api/sqlite.html) first appeared in 22.5;
early Node 22 releases require a flag. We try opening the module and database instead
of assuming support from the version. Node 18/20 can optionally install
`better-sqlite3@11`. Bun uses [bun:sqlite](https://bun.com/docs/runtime/sqlite).
Deno's Node compatibility layer is deliberately not treated as a local SQLite target.

The package exports ESM, CJS, and an edge-safe ESM build selected by `workerd`,
`edge-light`, or `browser` export conditions. Configure a custom edge bundler to use
one of these conditions. Deno can use `npm:@1a8jkf/universal-resilience-toolkit` after publication.

## Retry only

```ts
import { retry } from '@1a8jkf/universal-resilience-toolkit/retry';

const value = await retry(
  async ({ attempt, signal }) => {
    const response = await fetch('https://example.com', { signal });
    if (!response.ok)
      throw new Error(`Attempt ${attempt}: HTTP ${response.status}`);
    return response.text();
  },
  { maxAttempts: 3, initialDelay: '100ms', maxDelay: '2s', jitter: 'full' },
  { timeout: '5s' },
);
```

`maxAttempts` includes the first call. Defaults: 3 attempts, exponential backoff,
100ms initial delay, 30s cap, factor 2, full jitter. Constant backoff and `equal` or
`none` jitter are supported. `createRetry(options)` creates a reusable policy.

For attempt `n` that just failed, exponential delay is
`min(maxDelay, initialDelay * factor ** (n - 1))`. Full jitter multiplies this by a
random value in `[0, 1)`; equal jitter selects the upper half of that range.
`shouldRetry(error, attempt)` can narrow retryable failures. The final error is
re-thrown unchanged; there is no wrapper `RetryError`.

Retry only idempotent operations or supply an application idempotency key. HTTP error
responses do not throw by themselves; choose your status policy explicitly. The
library does not automatically handle `Retry-After` headers.

## Rate limit only

```ts
import { createRateLimiter } from '@1a8jkf/universal-resilience-toolkit/rate-limit';
import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';

const limiter = createRateLimiter({
  tokensPerInterval: 10,
  interval: '1s',
  algorithm: 'token-bucket',
  capacity: 20,
  key: 'email-provider',
  store: new MemoryStore(),
});

await limiter.execute(() => Promise.resolve('sent'));
// Or acquire a token before code you manage yourself:
await limiter.acquire();
```

Token buckets start full, continuously refill, and cap bursts at `capacity` (default:
`tokensPerInterval`). Choose `algorithm: 'sliding-window'` for an exact maximum of
`tokensPerInterval` admissions in `(now - interval, now]`; omit `capacity` in that mode.
Its timestamp log uses O(limit) storage per key; token buckets use O(1).

Rejections throw `RateLimitError` with `retryAfterMs` and `key`. There is no queue or
automatic wait. The state update is atomic. An admitted token is not refunded if an
operation fails or is subsequently aborted. Clock rollback cannot mint new tokens.

## Circuit breaker only

```ts
import { createCircuitBreaker } from '@1a8jkf/universal-resilience-toolkit/circuit-breaker';

const circuit = createCircuitBreaker({
  key: 'payments',
  failureThreshold: 5,
  resetTimeout: '30s',
  probeTimeout: '10s',
  successThreshold: 1,
});

const result = await circuit.execute(() => Promise.resolve('healthy'), {
  timeout: '5s',
});
const state = await circuit.getState(); // 'closed' | 'open' | 'half-open'
await circuit.close(); // closes owned persistence, not the circuit state machine
```

Closed circuits count consecutive failures in completion order; a success resets the
count. Open circuits reject with `CircuitOpenError.retryAfterMs`. After `resetTimeout`,
the next call atomically becomes the single half-open probe. Other calls fail fast.
`getState()` observes stored state; it does not itself admit a probe or advance time.

A successful probe closes the circuit after `successThreshold` sequential successes.
A failed probe reopens it for another reset interval. The probe lease allows recovery
when its caller crashes. A generation number fences late results from previous states.
Use `probeTimeout` longer than the expected operation timeout to avoid overlapping
probes. `shouldRecordFailure` can exclude application errors; excluded errors release
probe admission without proving recovery.

## Composition and cancellation

`withResilience(fn, options)` preserves argument types, return inference, and the
receiver when invoked with `.call()` or as a method. Every wrapped return is a Promise.
For explicit per-call options, use `wrapped.execute([arg1, arg2], { signal, timeout })`;
bind receiver-dependent functions first.

The order is **retry → circuit admission → rate admission → timed operation**.
Each retry consumes its own token and may count as a circuit failure. Circuit-open,
rate-limit, storage, configuration, and caller-abort errors are neither retried nor
counted as dependency failures. A timeout counts as a dependency failure. When retry
is omitted, there is exactly one attempt. Each capability can be configured alone.

For cooperative cancellation, use the context-aware API:

```ts
import { createResilience } from '@1a8jkf/universal-resilience-toolkit';

const operation = createResilience(
  ({ signal }) => fetch('https://example.com', { signal }),
  { timeout: '2s', retry: { maxAttempts: 3 }, persistence: { mode: 'memory' } },
);
const controller = new AbortController();
const response = await operation.execute({ signal: controller.signal });
await operation.close();
```

Timeouts bound each operation attempt, not the entire retry sequence or backend I/O.
Abort cancels active waiting and retry sleep. JavaScript cannot terminate a promise
that ignores its signal: timed-out work can continue and overlap later attempts.
Configure network deadlines on Redis clients separately. `withResilience` keeps the
original function signature, so it cannot automatically inject a signal into fetch.

Durations are milliseconds or strings with `ms`, `s`, `m`, `h`; positive values up to
2,147,483,647ms are accepted. Only retry delays may be zero. Injectable `clock` and
`random` hooks support deterministic tests; hosts sharing state need synchronized clocks.

## Persistence cascade and ownership

The first state access lazily selects a backend:

1. Explicitly injected Redis in automatic mode.
2. SQLite on Node/Bun if a driver loads and the actual database opens successfully.
3. Memory, with an optional `onFallback` diagnostic callback.

This is a selection order, not state migration. A selected backend failure raises
`StorageError`; the library never silently switches to fresh memory during an outage.
Explicit `mode: 'redis'` or `mode: 'sqlite'` also fails if unavailable.

```ts
import {
  createPersistence,
  withResilience,
} from '@1a8jkf/universal-resilience-toolkit';

const store = await createPersistence({
  mode: 'auto',
  sqlitePath: './state.sqlite',
  onFallback: (error) =>
    console.warn('Using non-durable memory:', error.message),
});
console.log(store.kind); // Inspect the selected layer before serving requests.
const wrapped = withResilience(() => Promise.resolve('ok'), {
  store,
  key: 'shared-operation',
  rateLimit: { tokensPerInterval: 10, interval: '1s' },
});
await wrapped();
await store.close?.();
```

Without an injected store, a wrapper owns its lazy persistence and releases it through
`close()`. Injected stores/Redis connections belong to the caller. Wait for in-flight
calls before closing. A shared `MemoryStore` instance shares state only within its
isolate. SQLite shares state only among connections to the same local file; it uses
WAL and `BEGIN IMMEDIATE` with a 5s busy timeout. SQLite calls are synchronous.

**Use stable keys and the same configuration across instances.** Without `key`, a
wrapper creates an isolated random key; it will not resume the same limits after a
restart. Internal keys are prefixed with `rate:` or `circuit:`. Conflicting settings
against a shared key raise `ConfigurationError`. Different failure predicates cannot
be compared automatically and must also be kept consistent by the application.

State does not expire automatically. Keep key cardinality bounded. Remove an inactive
key with `store.update(internalKey, () => ({ state: undefined, value: undefined }))`
only when no callers use it; deleting active state resets its protection. There is no
automatic eviction that could silently bypass a limit or reopen traffic.

## Force SQLite or Redis

```ts
import { createPersistence } from '@1a8jkf/universal-resilience-toolkit/persistence';
const store = await createPersistence({
  mode: 'sqlite',
  sqlitePath: './state.sqlite',
});
```

On Node 18/20 install the compatible optional driver:

```sh
npm install better-sqlite3@11
```

For distributed state, inject a client. The adapter has no network-client dependency
and supports TCP clients on servers or HTTP Redis clients at the edge:

```ts
import { createClient } from 'redis'; // Your application's optional dependency.
import { RedisStore } from '@1a8jkf/universal-resilience-toolkit/adapters/redis';
import { createPersistence } from '@1a8jkf/universal-resilience-toolkit';

const client = createClient({ url: process.env.REDIS_URL });
client.on('error', (error) =>
  console.error('Redis connection error:', error.message),
);
await client.connect();
const redis = new RedisStore({
  get: (key) => client.get(key),
  eval: (script, keys, args) => client.eval(script, { keys, arguments: args }),
});
const store = await createPersistence({ mode: 'redis', redis });
// Inject store into wrappers; close the client when the application shuts down.
await client.quit();
```

The backend must support `GET`, `EVAL`, `SET`, and `DEL`. A Lua compare-and-swap makes
each update atomic, including across independent RedisStore instances. Reducers can
be replayed and must be synchronous and pure. Default contention budget: 256 attempts;
exhaustion fails closed with `StorageError`. Each script accesses one Redis key, so no
cross-slot transaction is needed. This is not a multi-key distributed transaction.

## OpenTelemetry

Install `@opentelemetry/api` plus your preferred SDK/exporter and initialize the SDK
before calls. Node/Bun discover the optional API lazily. Without it, calls still work
without warnings. No provider, exporter, or background process is installed by the toolkit.

For Workers, Vercel Edge, and bundlers that cannot resolve optional runtime imports,
pass your application's tracer explicitly:

```ts
import { trace } from '@opentelemetry/api';
import { withResilience } from '@1a8jkf/universal-resilience-toolkit';
const wrapped = withResilience(() => Promise.resolve('ok'), {
  retry: { maxAttempts: 3 },
  telemetry: { tracer: trace.getTracer('my-service') },
});
await wrapped();
```

| Span                             | Attributes                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `resilience.retry.attempt`       | `retry.attempt`, `retry.max_attempts`; failed attempts record an exception and error status |
| `resilience.circuit.transition`  | `circuit.key`, `circuit.state`, `circuit.reason`                                            |
| `resilience.rate_limit.rejected` | `rate_limit.key`, `rate_limit.algorithm`, `rate_limit.retry_after_ms`                       |

Use `telemetry: { enabled: false }` to disable instrumentation. Tracer failures do not
affect resilience results. Keys and exception messages become trace data; avoid putting
credentials or personal data in them. Attempt spans do not install an active child
context around your operation; configure your application's context propagation normally.

## Troubleshooting

- **State resets across deployments:** supply a stable `key`. Use Redis for multiple
  machines/isolates. The automatic memory fallback is intentionally process-local.
- **SQLite cannot open:** check the directory and write permissions. Parent directories
  are not created automatically. Install `better-sqlite3@11` on Node 18/20 or choose
  an injected Redis adapter. Force `mode: 'sqlite'` to expose the opening error.
- **Unexpected memory fallback:** inspect `(await createPersistence()).kind`, enable
  `onFallback`, or force a mode. Automatic mode is not a production distribution policy.
- **Conflicting configuration:** all users of a key must agree on the policy settings.
  Choose a new versioned key when intentionally changing the policy and plan the reset.
- **No spans in edge:** initialize your SDK and inject its tracer. Edge bundles cannot
  discover packages using opaque dynamic imports.
- **Circuit remains half-open after a crash:** the next call after `probeTimeout`
  reclaims the lease. No background timer or process is required.
- **Redis outage or contention:** expect `StorageError`, not a fresh unlimited bucket.
  Inspect Redis availability, client deadlines, and the adapter's contention budget.

## Development and publishing

```sh
npm ci
npm run check
npm run test:bun
npm run test:deno
npm run test:workers
npm run test:edge
```

`check` runs strict types, ESLint, formatting, the Node behavior suite, adapter tests,
public ESM/CJS type tests, tree-shaking checks, and isolated tarball installation with
optional peers omitted. CI additionally tests real Redis 7/8 and the runtime matrix.
See [CONTRIBUTING.md](CONTRIBUTING.md) for Changesets and Conventional Commits.

The package is configured as `@1a8jkf/universal-resilience-toolkit` for
[GitHub Packages](https://github.com/1a8jkf/universal-resilience-toolkit/packages).
See [authentication and publication](docs/github-packages.md) and
[release notes](docs/release-review.md). The workflows use GitHub's automatic
`GITHUB_TOKEN` when `ENABLE_GITHUB_PACKAGES=true`. Local publication reads
`NODE_AUTH_TOKEN` from the environment. Nothing is published by build/test commands.

MIT. The future HTTP sidecar is intentionally outside this release.
