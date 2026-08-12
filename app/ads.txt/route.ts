import { buildAdsTxt } from "@/lib/monetization/ads-txt";
import {
  lastKnownAdsensePublisherId,
  readMonetizationSettings,
} from "@/lib/monetization/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/ads.txt` — the authorised-sellers file every ad network reads.
 *
 * ── Why a route and not a file in `public/` ───────────────────────────────────
 *
 * A static file would work and would need a redeploy to change. This is a value
 * an operator pastes from the AdSense dashboard during verification, often more
 * than once while getting a site approved, and often again when adding a second
 * network. Serving it from settings means that is a save in the admin.
 *
 * ── Content type matters more than usual here ─────────────────────────────────
 *
 * The IAB spec requires `text/plain`, and Google's crawler is strict about it —
 * a file served as `text/html` is treated as absent, which presents as
 * "we could not find your ads.txt" with a file that loads perfectly in a
 * browser. That is a common way this step fails.
 *
 * ── Never cached at the edge ──────────────────────────────────────────────────
 *
 * `no-store`, because the whole point of storing it in settings is that a change
 * takes effect immediately. A CDN holding the previous contents for an hour
 * during a verification retry loop is a genuinely maddening thing to debug.
 *
 * ── 🔴 The "Not found" incident (owner, 2026-08-10) ───────────────────────────
 *
 * AdSense showed `Ads.txt status: Not found` for a setting that was saved, while
 * the live file returned 200 `text/plain` with the correct record on every
 * manual check. Both were true, and this route was the reason.
 *
 * It read the settings through a helper that catches ALL failures and returns
 * defaults, in which `adsTxt` is empty — and then treated empty as "nothing is
 * configured" and answered 404. So a single transient Supabase failure, a cold
 * instance with an empty cache, or a dropped connection produced an
 * authoritative "this file does not exist", which Google records and does not
 * re-check for days. Every later manual check succeeds, so nothing about the
 * symptom points at a race that lasted one second.
 *
 * Two defences, and the order matters:
 *
 *   1. DERIVED, not merely stored. If an AdSense publisher id is configured,
 *      the record is a fact — `google.com, pub-…, DIRECT, <Google's cert>` —
 *      so the file cannot be missing while AdSense is set up at all, whatever
 *      is in the free-text box. See `buildAdsTxt`.
 *
 *   2. 503, not 404, when the settings could not be READ. A 4xx is a verdict; a
 *      5xx is "ask again". A crawler must never be told a file is absent
 *      because our database was briefly unavailable.
 */
/*
  🔴 The publisher id, from the environment, as a LAST RESORT (2026-08-10).

  ── Why the 503 was not the end of the story ─────────────────────────────────

  The incident above was fixed by refusing to answer 404 when the settings read
  fails. That is correct and it stays. But it leaves one real failure standing:
  if Supabase is unreadable, this file is *unavailable*, and unavailable is still
  not "here is your record". Google retries a 503 — it does not retry forever,
  and this project has already had a day where the database answered 429 to
  everything (see the download quota outage, 2026-08-09).

  A full audit of why AdSense still showed "Not found" is what surfaced this.
  The file itself is healthy — 200, `text/plain`, correct record, on the apex and
  on www, over http and https, to every Google crawler user agent, 40 fetches out
  of 40, in about 0.65s. Nothing is broken today. What is fragile is that a file
  whose entire content is DERIVABLE FROM A CONSTANT was still gated on a network
  round-trip to a database, on every single request, forever.

  ── Why an env var is the right shape for this ───────────────────────────────

  The AdSense record is not a preference, it is an identity:
  `google.com, pub-…, DIRECT, f08c47fec0942fa0`, where the cert is a constant
  Google publishes and the publisher id changes roughly never. A value that
  never changes and that revenue depends on should not be reachable only through
  the least reliable component in the request path.

  So: settings still WIN — the operator can add networks, comments and ordering
  in the admin, and that is what ships. This is consulted only when the read
  failed, and it turns "temporarily unavailable" into a correct file for the one
  publisher we can always name. If neither is available we still answer 503, not
  404, because the verdict rule from the incident is unchanged: a 4xx is a
  verdict, a 5xx is "ask again".

  Unset by default, so a deployment that has not configured it behaves exactly
  as before. NOT prefixed `NEXT_PUBLIC_` — this is read on the server only.
*/
const FALLBACK_PUBLISHER_ID = process.env.ADSENSE_PUBLISHER_ID ?? "";

export async function GET() {
  const { settings, degraded } = await readMonetizationSettings();

  if (degraded) {
    /*
      The read failed, so we do not know what the operator configured. But we
      may still know who the publisher is, and a correct file beats a correct
      error every time — the crawler is here to find a record, and we have one.
    */
    /*
      Two sources, explicit first. The env var is a deliberate operator act and
      is available on a cold instance; the remembered id is whatever this
      instance last read successfully, which covers the far more common case of
      a deployment that never set the env var but has served traffic today.
    */
    const fallback = buildAdsTxt({
      adsensePublisherId: FALLBACK_PUBLISHER_ID || lastKnownAdsensePublisherId(),
    }).trim();
    if (fallback) {
      return new Response(`${fallback}\n`, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          // Not cached: this is the DEGRADED answer, and it must not outlive the
          // outage that produced it. The moment the database is readable again
          // the operator's own file is what should be served.
          "Cache-Control": "no-store",
        },
      });
    }

    /*
      Nothing configured anywhere, and we could not read. We must not answer as
      if we know — in either direction. `Retry-After` is short because
      verification is usually an operator sitting in the AdSense dashboard
      pressing check.
    */
    return new Response("ads.txt temporarily unavailable\n", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "120",
      },
    });
  }

  const body = buildAdsTxt(settings).trim();

  /*
    Genuinely nothing configured — no pasted file and no publisher id — so 404.

    An empty ads.txt served with 200 is a POSITIVE assertion that no seller is
    authorised, which tells every network to stop serving. Absent means "not
    configured", which is the truth in this branch and is the safe answer.
  */
  if (!body) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(`${body}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
