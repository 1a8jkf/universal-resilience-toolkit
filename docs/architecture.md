# Architecture and decisions

This document records the design before implementation. All names are provisional.

## Assumptions

- One public package: `universal-resilience-toolkit`, initially version `0.1.0`, MIT.
- Node.js 18 is the minimum consumer runtime. Development tooling runs on Node 22+.
- No existing repository, owner, npm scope, GitHub remote, or registry credentials
  were supplied. Publication is prepared but is not performed.
- Durations accept milliseconds or explicit `ms`, `s`, `m`, and `h` suffixes.
- Limits are per explicitly named key. Automatically generated keys isolate wrappers;
  callers must supply stable keys to share state across restarts/processes.
- HTTP errors are application policy: fetch responses do not automatically throw.
- Local SQLite uses `.resilience-toolkit.sqlite` in the working directory by default.
  Node 18/20 need the optional `better-sqlite3` peer; newer Node and Bun can use built-ins.
- Clocks on hosts sharing a backend must be synchronized. No distributed global clock
  is claimed. Public clocks, random sources, and sleeps are injectable for testing.

## Layout

- `src/retry.ts`: retry decisions, exponential/constant backoff and jitter.
- `src/rate-limit.ts`: token bucket and exact sliding-window policies.
- `src/circuit-breaker.ts`: closed/open/half-open state machine and probe leases.
- `src/compose.ts`: argument-preserving `withResilience` wrapper.
- `src/types.ts`, `errors.ts`, `time.ts`: portable contracts and cancellation.
- `src/persistence.ts`: lazy backend selection and explicit overrides.
- `src/adapters/`: memory, SQLite, Redis adapters.
- `src/telemetry.ts`: optional OpenTelemetry and explicit tracer injection.
- `tests/`: portable contract suite, adapter integration, type assertions.
- `scripts/`: shared-suite runners for Node, Bun, Deno, workerd, and Vercel Edge.
- `.github/workflows/`: quality, runtime/backend matrix, and release automation.

## Trade-offs selected

**Single package with subpath exports vs. monorepo.** A single package keeps the first
install simple. Adapters remain separate lazy entries; no workspace publishing order
or mandatory runtime dependencies are introduced.

**Atomic update vs. separate get/set.** All policy state changes use one atomic
synchronous reducer. SQLite wraps it in `BEGIN IMMEDIATE`; Redis uses optimistic
compare-and-swap with Lua. Reducers can be replayed, so must have no side effects.
Redis contention has a finite retry budget and fails closed when exhausted.

**Automatic persistence vs. portability.** Prefer explicitly supplied Redis, then
available local SQLite, then memory. Detect capabilities, attempt opening the actual
database, and cache selection per wrapper. Explicit overrides never degrade silently.
There is no runtime failover after selection: losing state would bypass protections.

**Exact sliding windows vs. approximate counters.** An exact timestamp log is simpler
to verify and enforces the stated bound, at O(limit) space per key. Token buckets are
O(1) and allow an initial burst equal to capacity with continuous refill.

**One recovery probe vs. configurable parallel probes.** The MVP admits one half-open
probe per shared key. A lease recovers from a crashed or hung probe; generations fence
late completions. Consecutive failures count in completion order while closed.

**Composition order.** Retry wraps circuit admission, rate admission, and a timed
operation. Each actual attempt consumes a token and may count as a circuit failure.
Rate/circuit/storage rejections and caller cancellation are not retried or counted as
dependency failures. Ignored failures release half-open leases without closing the circuit.

**Timeout vs. forced termination.** A timeout bounds each attempt's awaited duration
and aborts its signal. It cannot terminate arbitrary promises; a retry may overlap an
operation that ignores cancellation. Callers must use idempotency and propagate signals.

**Observability vs. hard dependency.** Lazy optional API discovery is best effort;
explicit tracer injection supports bundlers that cannot resolve runtime imports.
Instrumentation failures never alter policy results. No global tracer provider is installed.

**Runtime verification.** The same behavioral cases execute inside each target runtime,
including the Workers handler and Vercel VM. Native storage tests are separate. Local
execution and remote CI execution are reported separately; no deployment is implied.

## Phase 2 boundary

Policy reducers and operation callbacks do not depend on Node, HTTP, framework request
objects, or global singleton state. A future proxy can supply request keys and adapters
around the same engine. No proxy, container image, or HTTP server is part of this MVP.
