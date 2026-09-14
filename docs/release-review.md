# Review before publishing 0.1.0

## Maintainer input still required

1. The owner is confirmed as `1a8jkf`; the package is
   `@1a8jkf/universal-resilience-toolkit`. Repository/homepage/bugs metadata is set.
   Finish authenticated upload and verify package publication before announcing it.
2. Push the repository and obtain green GitHub Actions runs, especially real Redis 7/8
   and Node 18/20 with the optional native driver. Local results are not remote CI proof.
3. Enable registry workflows after validation. GitHub Packages uses the repository
   owner scope and the workflow's automatic token; the default publishing registry
   is `https://npm.pkg.github.com`.

## MVP trade-offs

- Edge OpenTelemetry requires tracer injection; automatic package discovery is server
  only because Workers reject opaque dynamic module imports. This is a deliberate
  compatibility boundary, not a claim of automatic SDK discovery in all runtimes.
- Single half-open probe, finite lease, completion-order consecutive failure threshold.
  No rolling error ratio, bulkheads, fallback response values, or scheduled queues.
- Timeout is per operation attempt and cancels cooperatively. Redis transport deadlines
  and an overall retry budget are application responsibilities. Backend calls can outlast
  operation timeouts. Uncooperative work can overlap retries or replacement probes.
- SQLite is synchronous and local. Node 18/20 need an optional native driver. WAL works
  on local filesystems; multi-machine state must use Redis. Automatic mode opens a file
  in the working directory unless a path or mode is supplied.
- Redis reducers use bounded optimistic CAS. High contention can exhaust the budget;
  state stays protected by failing closed. A timeout after commit has an ambiguous
  outcome and is surfaced as a storage error; no unsafe rollback is attempted.
- State has no TTL/automatic eviction. Keep cardinality bounded and retire inactive
  keys explicitly. Automatically generated keys do not provide stable restart identity.
- Shared backends require synchronized host clocks. Clock rollback protection is local
  to rate state; large wall-clock jumps can affect refill/reset/probe timing.
- Telemetry spans contain configured keys and errors. Review them for sensitive data.
- Schema/config mismatches fail closed. Migration tooling is not included.
- Dual ESM/CJS builds can create distinct module identities when both are loaded in
  one process. Do not mix their error classes or expect module-singleton identity.
- The five-runtime checks use local runtime implementations, not deployments to hosted
  Cloudflare/Vercel infrastructure. Production load/latency benchmarking remains open.

## Tooling decisions

The core has no mandatory runtime dependencies. SQLite and OpenTelemetry are optional
peers; Redis accepts a structural client and does not install one. Dev tooling uses
Node 22+. Miniflare 4 is pinned; patched `sharp` and `undici` overrides avoid known
development-only dependency advisories without moving to a prerelease Miniflare major.
The tsup esbuild override uses a patched release. Revisit these overrides on upgrades.

No sidecar, Docker image, external service, or production deployment was created.
The publication follow-up created the private GitHub repository; authenticated
source upload and package publication are pending.
