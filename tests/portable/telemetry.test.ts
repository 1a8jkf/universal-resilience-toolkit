import { retry } from '@1a8jkf/universal-resilience-toolkit/retry';
import { createCircuitBreaker } from '@1a8jkf/universal-resilience-toolkit/circuit-breaker';
import { createRateLimiter } from '@1a8jkf/universal-resilience-toolkit/rate-limit';
import { MemoryStore } from '@1a8jkf/universal-resilience-toolkit/adapters/memory';
import type {
  Attributes,
  Tracer,
} from '@1a8jkf/universal-resilience-toolkit/telemetry';
import { assert, equal, fakeClock, rejects, test } from './harness';

test('telemetry emits attempt, circuit transition, and rate rejection spans', async () => {
  const spans: {
    name: string;
    attributes: Attributes;
    ended: boolean;
    failed: boolean;
  }[] = [];
  const tracer: Tracer = {
    startSpan(name, options) {
      const record = {
        name,
        attributes: options?.attributes ?? {},
        ended: false,
        failed: false,
      };
      spans.push(record);
      return {
        end: () => {
          record.ended = true;
        },
        recordException: () => {
          record.failed = true;
        },
        setStatus: () => {},
      };
    },
  };
  const telemetry = { tracer };
  const clock = fakeClock();
  await retry(
    ({ attempt }) => {
      if (attempt === 1) throw new Error('temporary');
      return 1;
    },
    { telemetry, clock, initialDelay: 0 },
  );
  const circuit = createCircuitBreaker({
    store: new MemoryStore(),
    telemetry,
    clock,
    failureThreshold: 1,
    resetTimeout: 1,
  });
  await rejects(
    () =>
      circuit.execute(() => {
        throw new Error('failure');
      }),
    'Error',
  );
  clock.advance(1);
  await circuit.execute(() => 1);
  const rate = createRateLimiter({
    store: new MemoryStore(),
    telemetry,
    tokensPerInterval: 1,
    interval: 1000,
  });
  await rate.acquire();
  await rejects(() => rate.acquire(), 'RateLimitError');
  equal(
    spans.filter((span) => span.name === 'resilience.retry.attempt').length,
    2,
  );
  equal(
    spans
      .filter((span) => span.name === 'resilience.circuit.transition')
      .map((span) => span.attributes['circuit.state']),
    ['open', 'half-open', 'closed'],
  );
  equal(
    spans.filter((span) => span.name === 'resilience.rate_limit.rejected')
      .length,
    1,
  );
  assert(spans.every((span) => span.ended));
  assert(spans[0]?.failed);
});
test('broken or disabled telemetry does not change results', async () => {
  const tracer: Tracer = {
    startSpan() {
      throw new Error('instrumentation failed');
    },
  };
  equal(await retry(() => 42, { telemetry: { tracer } }), 42);
  const brokenEnd: Tracer = {
    startSpan() {
      return {
        end() {
          throw new Error('end failed');
        },
        recordException() {
          throw new Error('failed');
        },
        setStatus() {},
      };
    },
  };
  await rejects(
    () =>
      retry(
        () => {
          throw new Error('operation failed');
        },
        { telemetry: { tracer: brokenEnd }, maxAttempts: 1 },
      ),
    'Error',
  );
  equal(await retry(() => 7, { telemetry: { enabled: false, tracer } }), 7);
});
