import { geoFromHeaders, isBotUA, parseUA } from "@/lib/analytics/enrich";

/**
 * GET /api/analytics/context — the ONE Vercel call left in the analytics path.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THIS SURVIVED WHEN THE COLLECT ROUTE DID NOT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: move custom event tracking off Vercel Observability.
 *
 * Events now go from the browser straight to Postgres (`lib/analytics/ingest`),
 * so no function is invoked to record one. But three of the fields every event
 * carries CANNOT be derived in a browser or in Postgres:
 *
 *   country / region / city   injected by the edge into request headers. The
 *                             browser cannot see its own geo headers, and
 *                             Postgres cannot see the IP.
 *   device / browser / os     parseable from `navigator.userAgent` in the
 *                             browser, but see below.
 *   is_bot                    the whole point is that it is NOT self-reported.
 *
 * Dropping them was considered and rejected: `region` feeds a live admin
 * breakdown (`analytics_breakdown` with p_dimension 'region') and is populated
 * on 89% of the last week's rows, `city` on 99%. The brief's Phase 7 is explicit
 * that existing metrics are not to be lost to the migration, so they stay.
 *
 * ── The cost shape, honestly ────────────────────────────────────────────────
 *
 * This is fetched ONCE PER SESSION, not once per event or once per batch. A
 * 30-minute session produced roughly 3–5 batch POSTs to the old collect route;
 * it now produces one call here. That is the reduction — large, and not total.
 * Saying it is total would be untrue.
 *
 * ── Three things this route deliberately does NOT do ────────────────────────
 *
 * 1. 🔴 IT DOES NOT LOG. Not one `console.*` line. A log line IS an
 *    observability event, and a route added during a migration to reduce them
 *    that printed a line per call would hand back most of the saving. The two
 *    routes this migration retires (`/api/vitals`, `/api/metrics/playback`)
 *    existed for nothing BUT their log line.
 * 2. It touches no database and reads no session, so there is no round-trip to
 *    wait on and nothing to fail.
 * 3. `runtime = "edge"`, not node. It is header arithmetic; an edge invocation
 *    is the cheapest thing Vercel offers and carries the smallest log footprint.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const geo = geoFromHeaders(request.headers);
  const uaRaw = request.headers.get("user-agent");
  const ua = parseUA(uaRaw);

  return Response.json(
    {
      country: geo.country,
      region: geo.region,
      city: geo.city,
      device: ua.device,
      browser: ua.browser,
      os: ua.os,
      /*
        Bot marking stays SERVER-side, which is the only place it means
        anything. `isBotUA` is deliberately conservative — a false positive
        silently deletes a real person from every metric — and events are
        MARKED rather than dropped so a mis-classification stays queryable and
        reversible (migration 0115).
      */
      isBot: isBotUA(uaRaw),
    },
    {
      headers: {
        /*
          Per-visitor by definition, so it must never be shared. `private`
          keeps Cloudflare out of it — this project has twice been bitten by
          Cloudflare rewriting a `public` max-age onto an API answer and
          serving one visitor's response to another for two hours.
        */
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}
