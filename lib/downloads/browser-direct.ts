import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isInternalWorkerCall } from "@/lib/api/download-quota";
import { directAllowedOrigin } from "@/lib/downloads/direct-ticket";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE BROWSER TALKS TO THE WORKER — no Vercel on the download path at all
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-08: "fix the vercel issue, so vercel doesn't consume … the
 * speed is what needs attention." Measured the same day on production, every
 * download paid for two Vercel hops before a byte moved: the metadata proxy and
 * a 0.8–1.9 s ticket call (a cold function, a Supabase Auth round trip, a plan
 * read, Redis). Both existed only to run checks the worker can run itself.
 *
 * So the worker now answers the browser directly for `/api/metadata` and
 * `/api/download`, and runs every check Vercel ran — the per-IP limiters, the
 * daily cap, the size cap, reward redemption. A call WITH the worker secret is
 * still the trusted server-to-server path and is unchanged.
 *
 * ── No preflight ────────────────────────────────────────────────────────────
 * The browser sends a `text/plain` POST with no custom headers: a CORS "simple
 * request", so there is no OPTIONS round trip. (A preflight is cached per URL,
 * and every download URL is different — a header would have cost one RTT on
 * every single download.) The member's access token rides in the BODY, never
 * the URL, so it is never written to an access log.
 *
 * ── Who the caller is ───────────────────────────────────────────────────────
 * The token is verified LOCALLY against the project's published ES256 keys
 * (`auth.getClaims`, keys cached by the library) — no Supabase Auth round trip
 * per download. A missing or bad token is simply an anonymous caller.
 */

export function browserCorsHeaders(request: Request): Record<string, string> {
  const origin = directAllowedOrigin(request.headers.get("origin"));
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "7200",
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Length, Retry-After",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

/** A call the worker must check itself: we ARE the worker and it lacks the secret. */
export function isBrowserDirectCall(request: Request): boolean {
  return !hasWorker && !isInternalWorkerCall(request);
}

/**
 * The client IP for limiter keys on a browser-direct call.
 *
 * 🔴 NOT the first `X-Forwarded-For` entry: on a direct call that is whatever the
 * browser chose to send, so keying on it would let anyone mint a fresh anonymous
 * quota per request. The edge in front of the worker APPENDS the address it saw,
 * so the trustworthy hop is the LAST one; `X-Real-IP` (set by the edge) first.
 * Measured live — see `/api/health?whoami=1`.
 */
export function trustedClientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || "anonymous";
}

let authClient: SupabaseClient | null = null;
function auth(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  authClient ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return authClient;
}

/** The member a browser-sent access token belongs to, or null (anonymous / invalid / expired). */
export async function userIdFromAccessToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return null;
  const client = auth();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getClaims(token);
    const sub = data?.claims?.sub;
    return !error && typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/** The body of a browser-direct call — `text/plain` holding JSON (see above). */
export async function readTextJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return null;
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
