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
export async function POST(request: Request) {
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
