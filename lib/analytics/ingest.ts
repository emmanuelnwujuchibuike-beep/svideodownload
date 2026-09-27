"use client";

/**
 * The transport that took the Vercel function out of the analytics path.
 *
 * ── What changed and why ────────────────────────────────────────────────────
 *
 * Owner, 2026-09-27: "reduce Vercel Observability event usage/cost."
 *
 * Every batch used to POST to `/api/analytics/collect` — a Node function whose
 * entire job was to forward rows to Supabase. 22,121 events in the last seven
 * days each woke that function and each produced a request log entry, and
 * request logs are what the Observability meter counts. The destination table
 * was always Supabase; only the courier was billed.
 *
 * So batches now go straight to `rpc/track_events` on `*.supabase.co`. Nothing
 * about Vercel's hosting, CDN, middleware or any functional route changes — this
 * is one `fetch` pointed at a different origin, and that origin is not Vercel,
 * so the invocation and its log line simply stop existing.
 *
 * ── 🔴 WHY THIS IS RAW `fetch` AND NOT `supabase.rpc()` ─────────────────────
 *
 * Two reasons, both load-bearing:
 *
 * 1. `keepalive`. The last flush of a visit happens on `pagehide`, when the
 *    document is being torn down. A normal `fetch` is cancelled with the page;
 *    `keepalive: true` is what survives it. `supabase-js` does not expose
 *    per-call fetch options, so the final `page_exit` of every session — the
 *    only event that carries real dwell time, and therefore the entire basis of
 *    "time on page" and bounce rate — would be the one event most likely to be
 *    dropped.
 *
 * 2. Bytes. This module is reached from the landing page's cold entry, which has
 *    a 275 KiB budget. `@supabase/ssr` and the postgrest/realtime code behind it
 *    are an order of magnitude more than the whole collector. The token read
 *    below goes through `client-lazy`, which keeps the library behind its own
 *    `import()`, and nothing else here touches it.
 *
 * ── Why `sendBeacon` is the FALLBACK and not the primary ────────────────────
 *
 * `sendBeacon` cannot set request headers. Supabase needs `apikey`, and — the
 * part that matters — `Authorization: Bearer <jwt>` is what makes `auth.uid()`
 * inside `track_events` return the signed-in member rather than null. A beacon
 * would therefore record every member's activity as a guest's, which is exactly
 * the attribution the admin's signed-in-user views read. It stays as a last
 * resort for browsers where `keepalive` is unavailable, with the api key in the
 * query string (Supabase's gateway accepts it there) and the attribution loss
 * accepted rather than hidden.
 */

import { getClient } from "@/lib/supabase/client-lazy";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when there is somewhere to send to at all. */
export const ingestConfigured = !!URL_BASE && !!ANON_KEY;

/**
 * The signed-in member's access token, cached synchronously.
 *
 * ── Why it is cached rather than read per flush ──────────────────────────────
 *
 * `auth.getSession()` is async, and the `pagehide` flush has no opportunity to
 * await anything — the document is already going. A token that can only be
 * obtained asynchronously is a token the most important flush cannot use.
 *
 * `null` means "no session, or not primed yet". Both send with the anon key, so
 * the worst case is a guest-attributed row, never a lost one.
 */
let accessToken: string | null = null;
let priming: Promise<void> | null = null;

/**
 * Fetch the session once and keep the token current.
 *
 * Called on module load — i.e. after hydration, since the collector itself is
 * dynamically imported — so the token is normally in hand long before anyone
 * navigates away. Idempotent, and every failure is swallowed: a visitor whose
 * session cannot be read is a guest as far as analytics is concerned, which is
 * the correct degradation.
 *
 * ⚠️ There is a real window here. A member who lands and leaves within the few
 * hundred milliseconds before `getSession()` resolves has that first page view
 * recorded as a guest. Stated rather than papered over: closing it would mean
 * blocking the first flush on auth, and analytics does not get to delay itself
 * into the critical path for a rounding error in attribution.
 */
export function primeIdentity(): Promise<void> {
  if (priming) return priming;
  priming = (async () => {
    try {
      const supabase = await getClient();
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
      // Keep it fresh: a token refresh mid-visit, a sign-in, or a sign-out all
      // have to be reflected or events start landing under the wrong identity.
      // A sign-out must clear it, not keep writing as the member who left.
      supabase.auth.onAuthStateChange((_event, session) => {
        accessToken = session?.access_token ?? null;
      });
    } catch {
      accessToken = null;
    }
  })();
  return priming;
}

function rpcUrl(fn: string, withKeyInQuery = false): string {
  const base = `${URL_BASE}/rest/v1/rpc/${fn}`;
  return withKeyInQuery ? `${base}?apikey=${encodeURIComponent(ANON_KEY)}` : base;
}

/**
 * Post one batch to a `track_*` function.
 *
 * Resolves `true` only when the row(s) were accepted. A `false` tells the caller
 * to put the batch back on the queue and try on the next flush — the same
 * contract the old endpoint had, which is what keeps the exactly-once guarantee
 * meaningful (`on conflict do nothing` handles the replay).
 *
 * 🔴 NEVER THROWS. Analytics must never be able to surface an error into the
 * action that fired it — a download, a sign-in, a generation.
 */
export async function postIngest(
  fn: "track_events" | "track_download_state",
  payload: Record<string, unknown>,
  unloading = false,
): Promise<boolean> {
  if (!ingestConfigured) return false;

  const body = JSON.stringify(payload);
  const token = accessToken;

  try {
    const res = await fetch(rpcUrl(fn), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        // The member's own JWT when there is one, so `auth.uid()` resolves
        // inside the function. The anon key is a valid bearer for a guest.
        Authorization: `Bearer ${token ?? ANON_KEY}`,
        /*
          PostgREST would otherwise return the function's result. We only ever
          need "did it land", and asking for nothing back keeps the response
          empty — which matters on the unload path where the body would be read
          by a document that is already gone.
        */
        Prefer: "return=minimal",
      },
      body,
      // Survives the page teardown. This is the whole reason for raw fetch.
      keepalive: true,
    });
    return res.ok;
  } catch {
    /*
      `keepalive` has a body-size ceiling (64 KiB) and is not universal. A batch
      here is a few hundred bytes, so the realistic failure is an offline device
      or a browser without support — and on the way out, a beacon that loses the
      member's identity still beats losing the event.
    */
    if (unloading && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        return navigator.sendBeacon(
          rpcUrl(fn, true),
          new Blob([body], { type: "application/json" }),
        );
      } catch {
        return false;
      }
    }
    return false;
  }
}
