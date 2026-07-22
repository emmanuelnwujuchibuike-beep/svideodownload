/**
 * Next.js instrumentation hook — runs ONCE at server startup, off the request hot
 * path. The professional place to wire process-wide observability without taxing
 * any page (and without touching the root layout / the 2-second budget).
 *
 * Kept minimal on purpose: it installs event metering. A real distributed-tracing
 * exporter (OTLP) would be attached here too, guarded by its env — see
 * `lib/observability/trace.ts`.
 */
export async function register() {
  // Node runtime only — the edge runtime doesn't run our server observability.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installEventTracing } = await import("@/lib/observability/event-observability");
    installEventTracing();
  }
}
