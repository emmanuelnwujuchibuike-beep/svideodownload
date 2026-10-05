import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

/**
 * Collects Content-Security-Policy-Report-Only violations (see next.config.ts
 * `buildCsp()`) so real production origins can be observed in Vercel function
 * logs before the policy is ever tightened to enforce. Browsers POST these
 * unauthenticated and cross-origin by design — this endpoint does no DB write,
 * just a capped, best-effort log line, so it stays cheap even if hit directly.
 */
/**
 * 🔴 SILENT UNLESS SOMEBODY IS ACTUALLY READING (2026-10-04).
 *
 * A log line here is not free: every CSP violation POSTs, and every
 * `console.warn` on Vercel is an Observability event. The report-only policy
 * that generated most of this traffic is now opt-in (see next.config.ts), and
 * the enforcing policy's violations are rare but can arrive in bursts — one
 * misbehaving third-party script can fire the same violation on every page
 * load, which is exactly when a per-request log costs the most.
 *
 * So the write is gated on the same flag that turns the reporting on. With the
 * flag off this still answers 204 — a browser mid-navigation, or a direct
 * hit, must not get an error — it just does not pay to narrate it.
 */
const LOGGING = process.env.CSP_REPORT_URI === "1";

export async function POST(request: Request) {
  if (!LOGGING) {
    // The body is deliberately not read: nothing will be done with it, and
    // draining it only to discard it is work billed for no reason.
    return new NextResponse(null, { status: 204 });
  }
  try {
    const raw = await request.text();
    if (raw.length <= MAX_BODY_BYTES) {
      const parsed: unknown = JSON.parse(raw);
      console.warn("[csp-report]", JSON.stringify(parsed));
    }
  } catch {
    /* malformed/oversized report — nothing to log */
  }
  return new NextResponse(null, { status: 204 });
}
