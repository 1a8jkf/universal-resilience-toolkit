# Verification record

Local validation on 2026-09-14, Windows x64. The project is a release candidate, not
an already published or remotely deployed package.

## Shared portable suite

The same 27 behavioral tests import the **built public package exports** and execute
inside each runtime. The runner bundles the test harness; Workers assertions run
inside the request handler, and Vercel assertions run inside the VM. Tests are not
merely Node tests with a changed runtime label.

| Runtime            | Locally executed version/tool                                    | Result     |
| ------------------ | ---------------------------------------------------------------- | ---------- |
| Node               | 18.20.8 and 24.16.0                                              | 27/27 each |
| Bun                | 1.4.2                                                            | 27/27      |
| Deno               | 2.9.6                                                            | 27/27      |
| Cloudflare Workers | Miniflare 4.20260730.0 using workerd, no Node compatibility flag | 27/27      |
| Vercel Edge        | Official `@edge-runtime/vm` 5.0.0                                | 27/27      |

Coverage includes backoff, jitter/caps, exceptions, caller cancellation,
hung-operation timeouts, exact window boundaries, clock rollback, 200-way admission
races across shared wrappers, circuit transitions, single-probe admission,
late-completion fencing, expired leases, cascading failures, composition argument
isolation, persistence overrides, fail-closed storage errors, optimistic CAS
contention, and telemetry/error isolation.

## Backend and package integration

- Five Node integration tests passed: independent SQLite connections and reopen;
  four-thread SQLite rate admission; forced/automatic persistence failures;
  independent Redis CAS adapters with a deterministic in-process client; real
  OpenTelemetry API/provider discovery and finished spans.
- Bun's native SQLite write, close, reopen, read, and filesystem cleanup passed.
  The initial Windows run revealed unfinalized statements; explicit statement
  finalization fixed that resource leak.
- Real Redis **8.0.5** ran locally in the existing Ubuntu WSL installation on a
  dedicated loopback test port with persistence disabled. The integration suite
  passed using two independent client connections, Lua CAS, 100 concurrent increments,
  both rate algorithms, circuit recovery admission, deletion, and connection failure.
  Only randomly prefixed test keys were removed. The temporary server was stopped.
- Strict TypeScript, public ESM/CJS inference and negative type assertions, ESLint,
  and Prettier checks passed.
- ESM and CJS exports were loaded. A packed tarball was installed into a separate
  temporary consumer **without optional peers**; runtime and TypeScript consumption
  passed. Tree-shaking tests verify retry-only imports omit rate/circuit/SQLite code.
- Browser bundles were checked for unresolved dynamic imports. The edge export
  conditions select the production build rather than a test-only shim.
- `npm audit` reported no known vulnerabilities in the installed dependency graph
  at validation time. The core has no mandatory runtime dependencies.

## Reproduce

```sh
npm ci
npm run check
npm run test:bun
bun scripts/sqlite-smoke.mjs
npm run test:deno
npm run test:workers
npm run test:edge
REDIS_URL=redis://127.0.0.1:6379 npm run test:redis
```

Use `NODE_BIN`, `BUN_BIN`, or `DENO_BIN` to supply a specific runtime binary to the
portable runner. Tooling itself runs on Node 22+. The `.test-build/` directory contains
generated test bundles, result JSON, and the packed npm artifact.

## Not yet verified remotely

GitHub Actions has not run yet. A private repository has now been created at
`https://github.com/1a8jkf/universal-resilience-toolkit`; authenticated upload and
publication are pending. CI is configured for
Node 18/20/22/24, Bun, Deno, workerd, and Vercel Edge; backend jobs cover native SQLite
and optional `better-sqlite3` on older Node plus real Redis 7 and 8. Local Node 20/22,
the older-Node optional SQLite driver, and hosted provider deployments are not claimed
as executed. There are no benchmark, load SLA, or production-readiness guarantees.
