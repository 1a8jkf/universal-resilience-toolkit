import { optionalImport } from './optional-import';

/** Structural subset implemented by OpenTelemetry spans and tracers. */
export interface Span {
  recordException(error: Error | string): unknown;
  setStatus(status: { code: number }): unknown;
  end(): void;
}
export interface Tracer {
  startSpan(name: string, options?: { attributes: Attributes }): Span;
}
export interface TelemetryOptions {
  tracer?: Tracer;
  enabled?: boolean;
}
export type Attributes = Record<string, string | number | boolean>;

let discovered: Promise<Tracer | undefined> | undefined;
async function discover(): Promise<Tracer | undefined> {
  discovered ??= (async () => {
    try {
      // An opaque optional import keeps absent peers out of mandatory edge bundles.
      const specifier = '@opentelemetry/api';
      const api = (await optionalImport(
        specifier,
      )) as typeof import('@opentelemetry/api');
      return api.trace.getTracer('universal-resilience-toolkit');
    } catch {
      return undefined;
    }
  })();
  return discovered;
}

function safe(action: () => void): void {
  try {
    action();
  } catch {
    /* Observability must not change operation semantics. */
  }
}

export async function startSpan(
  name: string,
  attributes: Attributes,
  options?: TelemetryOptions,
): Promise<Span | undefined> {
  if (options?.enabled === false) return undefined;
  try {
    const tracer = options?.tracer ?? (await discover());
    return tracer?.startSpan(name, { attributes });
  } catch {
    return undefined;
  }
}

export function finishSpan(span: Span | undefined, error?: unknown): void {
  if (!span) return;
  if (error !== undefined)
    safe(() => {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: 2 });
    });
  safe(() => span.end());
}

export async function emitSpan(
  name: string,
  attributes: Attributes,
  options?: TelemetryOptions,
): Promise<void> {
  finishSpan(await startSpan(name, attributes, options));
}
