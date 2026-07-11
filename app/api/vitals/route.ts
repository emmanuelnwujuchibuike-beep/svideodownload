export const runtime = "edge";

/**
 * Lightweight Web Vitals sink. Accepts sampled `navigator.sendBeacon` payloads
 * from features/perf/web-vitals and logs them (captured by the platform's server
 * logs) so real-user Core Web Vitals regressions are visible without a paid RUM
 * service. Intentionally does no storage/auth — it's fire-and-forget telemetry.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const text = await request.text();
    const d = JSON.parse(text) as {
      name?: string;
      value?: number;
      rating?: string;
      path?: string;
      cores?: number;
      memGb?: number;
      conn?: string;
    };
    if (d?.name) {
      // Device context is opportunistic (Chrome/Edge/Android-only fields may
      // be absent) — grep "[vitals]" in logs to correlate scores with device
      // capability once enough real-user samples land.
      const ctx = [
        d.cores !== undefined ? `cores=${d.cores}` : null,
        d.memGb !== undefined ? `mem=${d.memGb}GB` : null,
        d.conn ? `conn=${d.conn}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      // eslint-disable-next-line no-console
      console.log(`[vitals] ${d.name}=${d.value} ${d.rating ?? ""} ${d.path ?? ""} ${ctx}`.trim());
    }
  } catch {
    /* ignore malformed beacons */
  }
  return new Response(null, { status: 204 });
}
