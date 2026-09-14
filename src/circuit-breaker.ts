import {
  ConfigurationError,
  CircuitOpenError,
  isPolicyRejection,
} from './errors';
import { lazyPersistence, policyKey, updateState } from './persistence';
import type { PersistenceOptions } from './persistence';
import { emitSpan } from './telemetry';
import type { TelemetryOptions } from './telemetry';
import {
  durationMs,
  positiveInteger,
  runAttempt,
  systemClock,
  throwIfAborted,
} from './time';
import type {
  Duration,
  ExecutionOptions,
  Operation,
  PolicyEnvironment,
  StateStore,
} from './types';

export type CircuitState = 'closed' | 'open' | 'half-open';
export interface CircuitBreakerOptions extends PolicyEnvironment {
  failureThreshold?: number;
  resetTimeout?: Duration;
  /** A single half-open probe is admitted; its lease recovers from crashes. */
  probeTimeout?: Duration;
  successThreshold?: number;
  shouldRecordFailure?: (error: unknown) => boolean;
  key?: string;
  store?: StateStore;
  persistence?: PersistenceOptions;
  telemetry?: TelemetryOptions;
}
type RecordState = {
  config: string;
  status: CircuitState;
  generation: number;
  failures: number;
  successes: number;
  retryAt: number;
  leaseUntil: number;
};
type Admission = {
  admitted: boolean;
  generation: number;
  probe: boolean;
  retryAfterMs: number;
  transition?: CircuitState;
};

export function createCircuitBreaker(options: CircuitBreakerOptions = {}) {
  const threshold = positiveInteger(
    options.failureThreshold ?? 5,
    'failureThreshold',
  );
  const successes = positiveInteger(
    options.successThreshold ?? 1,
    'successThreshold',
  );
  const reset = durationMs(options.resetTimeout ?? '30s', 'resetTimeout');
  const probeTimeout = durationMs(
    options.probeTimeout ?? '30s',
    'probeTimeout',
  );
  const key = policyKey('circuit', options.key);
  const config = JSON.stringify([1, threshold, successes, reset, probeTimeout]);
  const store = options.store ?? lazyPersistence(options.persistence);
  const clock = options.clock ?? systemClock;

  function initial(): RecordState {
    return {
      config,
      status: 'closed',
      generation: 0,
      failures: 0,
      successes: 0,
      retryAt: 0,
      leaseUntil: 0,
    };
  }
  function checked(previous?: RecordState): RecordState {
    if (previous && previous.config !== config)
      throw new ConfigurationError(
        `Conflicting circuit configuration for key "${key}".`,
      );
    return previous ?? initial();
  }
  async function transition(
    state: CircuitState | undefined,
    reason: string,
  ): Promise<void> {
    if (state)
      await emitSpan(
        'resilience.circuit.transition',
        {
          'circuit.key': key,
          'circuit.state': state,
          'circuit.reason': reason,
        },
        options.telemetry,
      );
  }
  async function admit(): Promise<Admission> {
    const now = clock.now();
    return updateState<RecordState, Admission>(store, key, (previous) => {
      const state = checked(previous);
      if (state.status === 'closed')
        return {
          state,
          value: {
            admitted: true,
            generation: state.generation,
            probe: false,
            retryAfterMs: 0,
          },
        };
      const readyAt =
        state.status === 'open' ? state.retryAt : state.leaseUntil;
      if (readyAt > now)
        return {
          state,
          value: {
            admitted: false,
            generation: state.generation,
            probe: true,
            retryAfterMs: readyAt - now,
          },
        };
      const changed = state.status !== 'half-open';
      state.status = 'half-open';
      state.generation++;
      state.leaseUntil = now + probeTimeout;
      return {
        state,
        value: {
          admitted: true,
          generation: state.generation,
          probe: true,
          retryAfterMs: 0,
          ...(changed ? { transition: 'half-open' as const } : {}),
        },
      };
    });
  }
  async function complete(
    admission: Admission,
    outcome: 'success' | 'failure' | 'ignored',
  ): Promise<void> {
    const now = clock.now();
    const changed = await updateState<RecordState, CircuitState | undefined>(
      store,
      key,
      (previous) => {
        const state = checked(previous);
        if (state.generation !== admission.generation)
          return { state, value: undefined };
        let changed: CircuitState | undefined;
        if (admission.probe) {
          if (outcome === 'failure') {
            state.status = 'open';
            state.generation++;
            state.retryAt = now + reset;
            state.successes = 0;
            changed = 'open';
          } else if (outcome === 'success' && ++state.successes >= successes) {
            state.status = 'closed';
            state.generation++;
            state.failures = 0;
            state.successes = 0;
            state.leaseUntil = 0;
            changed = 'closed';
          } else {
            // Release the lease. A rejected rate admission is not proof of recovery.
            state.leaseUntil = 0;
            state.generation++;
          }
        } else if (state.status === 'closed') {
          if (outcome === 'success') state.failures = 0;
          else if (outcome === 'failure' && ++state.failures >= threshold) {
            state.status = 'open';
            state.generation++;
            state.retryAt = now + reset;
            state.successes = 0;
            changed = 'open';
          }
        }
        return { state, value: changed };
      },
    );
    await transition(changed, outcome);
  }

  return {
    async execute<T>(
      operation: Operation<T>,
      execution: ExecutionOptions = {},
    ): Promise<T> {
      throwIfAborted(execution.signal);
      const admission = await admit();
      if (!admission.admitted)
        throw new CircuitOpenError(admission.retryAfterMs, key);
      await transition(admission.transition, 'probe-admitted');
      let result: T;
      try {
        result = await runAttempt(operation, 1, execution);
      } catch (error) {
        let outcome: 'failure' | 'ignored' = 'ignored';
        try {
          if (
            !isPolicyRejection(error) &&
            (options.shouldRecordFailure?.(error) ?? true)
          )
            outcome = 'failure';
        } finally {
          await complete(admission, outcome);
        }
        throw error;
      }
      await complete(admission, 'success');
      return result;
    },
    async getState(): Promise<CircuitState> {
      return updateState<RecordState, CircuitState>(store, key, (previous) => {
        const state = checked(previous);
        return { state, value: state.status };
      });
    },
    async close(): Promise<void> {
      if (!options.store) await store.close?.();
    },
  };
}

export { CircuitOpenError } from './errors';
