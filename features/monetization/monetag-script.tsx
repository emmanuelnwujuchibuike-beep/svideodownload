import { resolveMonetagTags } from "@/lib/monetization/monetag";
import { getMonetizationSettings } from "@/lib/monetization/settings";

/**
 * The site-level Monetag loader, rendered into `<head>` on every page — the
 * owner's chosen network alongside AdSense (Adsterra/PropellerAds retired,
 * 2026-07-26).
 *
 * ── One tag per Monetag format ────────────────────────────────────────────────
 *
 * Monetag's products (Multitag, In-Page Push, Push Notifications, Vignette Banner,
 * OnClick / Popunder) are each a separate self-placing site-level `<script>` with
 * its own `data-zone`. This emits ALL of them — the primary Multitag plus every
 * per-type unit configured in the admin — resolved and de-duplicated by
 * `resolveMonetagTags`. Turning the `monetag` switch off silences every one.
 *
 * ── Why parsed snippets, not raw ones ─────────────────────────────────────────
 *
 * Monetag gives you a `<script src="//…" data-zone="…" …>` snippet. Rendering an
 * admin free-text field into `<head>` as MARKUP would be a stored-XSS primitive —
 * the same reason `verificationTags` are emitted as structured `<meta>` and never
 * as HTML. So each snippet is EXTRACTED to its `src` (https only) + `data-zone`
 * and re-emitted as a structured `<script>`. Anything that isn't a clean https
 * script URL renders nothing.
 *
 * ── Why it also verifies the site ─────────────────────────────────────────────
 *
 * Monetag's own "file" verification wants `sw.js` at the site root — impossible
 * here, that path is the PWA service worker (offline / push / install). Monetag's
 * "code" method instead looks for these tags in the served HTML, so server-
 * rendering them (like the AdSense site script) satisfies verification too.
 *
 * ── Server-rendered + async ───────────────────────────────────────────────────
 *
 * Server-rendered so Monetag's crawler sees it; `async` so it never blocks the
 * parser or the LCP. CSP already allows it — `script-src` includes `https:` and
 * the standing rule is that ads must never be CSP-blocked.
 */
export async function MonetagScript() {
  const settings = await getMonetizationSettings();
  const tags = resolveMonetagTags(settings);
  if (tags.length === 0) return null;

  return (
    <>
      {tags.map((tag) => (
        <script
          key={`${tag.src}|${tag.zone ?? ""}`}
          async
          src={tag.src}
          {...(tag.zone ? { "data-zone": tag.zone } : {})}
          {...(tag.cfAsync ? { "data-cfasync": "false" } : {})}
        />
      ))}
    </>
  );
}
