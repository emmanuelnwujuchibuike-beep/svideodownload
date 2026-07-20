import { getMonetizationSettings } from "@/lib/monetization/settings";

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
 * browser. That is the single most common way this step fails.
 *
 * ── Never cached at the edge ──────────────────────────────────────────────────
 *
 * `no-store`, because the whole point of storing it in settings is that a change
 * takes effect immediately. A CDN holding the previous contents for an hour
 * during a verification retry loop is a genuinely maddening thing to debug.
 */
export async function GET() {
  const settings = await getMonetizationSettings();
  const body = settings.adsTxt.trim();

  /*
    An empty file returns 404 rather than 200-with-nothing.

    An empty ads.txt is a POSITIVE assertion that no seller is authorised, which
    tells a network to stop serving. Absent means "not configured", which is the
    truth here and is safe. A blank 200 would be actively harmful.
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
