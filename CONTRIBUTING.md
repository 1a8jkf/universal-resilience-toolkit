# Contributing

Use Node.js 22+ for development. Consumers can use Node.js 18+.

```sh
npm ci
npm run check
npm run test:workers
npm run test:edge
```

Install Bun and Deno to run `npm run test:bun` and `npm run test:deno`. Run Redis 7
locally and set `REDIS_URL=redis://127.0.0.1:6379` before `npm run test:redis`.

Use Conventional Commits, for example `fix(circuit): fence stale probe results` or
`feat(retry): add a backoff option`. Add a Changeset with `npm run changeset` for a
public API or behavior change. Keep code, errors, tests, and documentation in English.

Add behavioral regressions to `tests/portable/`; every test there executes inside all
five target runtimes. Use an injected clock for timing decisions, and real timers for
abort/timeout tests. Add real backend integration tests for changes to atomicity.
Type regressions belong in `tests/types/` and must test the built package exports.

Run `npm run format` before committing. CI rejects lint, format, type, runtime,
integration, and package-resolution failures. Explain behavior, validation, and
remaining limitations in PRs. Never introduce mandatory core runtime dependencies.

See [architecture](docs/architecture.md) and [release review](docs/release-review.md)
before changing state schema or publishing. State keys are versioned by configuration;
deploying incompatible settings against a shared key deliberately fails closed.
