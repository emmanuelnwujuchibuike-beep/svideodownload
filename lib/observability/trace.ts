/**
 * Tracing & metrics — server-side operation spans and counters.
 *
 * The brief's Observability layer, built honestly for one deployable: `withSpan`
 * times an operation and records it; `increment` meters events. Both keep a bounded
 * in-memory buffer for introspection, and a pluggable `setSpanExporter` seam so a
 * real collector (OTLP → Honeycomb/Datadog/…) can be attached in an environment that
 * has one — WITHOUT coupling the app to a backend that doesn't exist here.
 *
 * Scope, stated plainly: this is IN-PROCESS and PER-INSTANCE. It is real tracing of
 * server operations, not distributed tracing across the web tier and the worker —
 * that needs trace-context propagation + a collector and is marked `planned` in the
 * governance manifest and Service Registry. What's here is the seam and the spans;
 * the exporter is the one env-gated piece.
 */

export interface Span {
  name: string;
  startedAt: number;
  durationMs: number;
  status: "ok" | "error";
  attributes?: Record<string, string | number | boolean>;
  error?: string;
}

type SpanExporter = (span: Span) => void;

const MAX_SPANS = 200;
const recent: Span[] = [];
let exporter: SpanExporter | null = null;

/** Attach a real exporter (e.g. OTLP). `null` clears it. Errors are swallowed. */
export function setSpanExporter(fn: SpanExporter | null): void {
  exporter = fn;
}

function record(span: Span): void {
  recent.push(span);
  if (recent.length > MAX_SPANS) recent.shift();
  if (exporter) {
    try {
      exporter(span);
    } catch {
      // Export must never break the operation being traced.
    }
  }
}

/**
 * Run `fn` inside a timed span. Records ok/error + duration, then returns the
 * result or re-throws — tracing is transparent to the traced code.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    record({ name, startedAt, durationMs: Date.now() - startedAt, status: "ok", attributes });
    return result;
  } catch (err) {
    record({
      name,
      startedAt,
      durationMs: Date.now() - startedAt,
      status: "error",
      attributes,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** The recent spans (bounded ring buffer) — for an admin/diagnostics view. */
export function recentSpans(): readonly Span[] {
  return recent;
}

/* --------------------------------- metrics --------------------------------- */

const counters = new Map<string, number>();

export function increment(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function metricsSnapshot(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** Test-only: clear spans, counters and the exporter. */
export function __resetObservability(): void {
  recent.length = 0;
  counters.clear();
  exporter = null;
}
