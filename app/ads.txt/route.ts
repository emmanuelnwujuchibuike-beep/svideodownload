import { buildAdsTxt } from "@/lib/monetization/ads-txt";
import { readMonetizationSettings } from "@/lib/monetization/settings";

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
export async function GET() {
  const { settings, degraded } = await readMonetizationSettings();

  /*
    The read failed. We do not know what is configured, so we must not answer as
    if we do — in either direction. `Retry-After` is short because verification
    is usually an operator sitting in the AdSense dashboard pressing check.
  */
  if (degraded) {
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
