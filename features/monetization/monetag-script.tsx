import { getMonetizationSettings } from "@/lib/monetization/settings";

/**
 * The site-level Monetag loader, rendered into `<head>` on every page — the
 * owner's chosen network alongside AdSense (Adsterra/PropellerAds retired,
 * 2026-07-26).
 *
 * ── Why a parsed snippet, not a raw one ───────────────────────────────────────
 *
 * Monetag gives you a `<script src="//…" data-zone="…" …>` snippet. Rendering an
 * admin free-text field into `<head>` as MARKUP would be a stored-XSS primitive —
 * the same reason `verificationTags` are emitted as structured `<meta>` and never
 * as HTML. So this EXTRACTS the `src` (https only) and `data-zone` from whatever
 * the operator pasted and re-emits a structured `<script>`. Anything that isn't a
 * clean https script URL renders nothing.
 *
 * ── Why it also verifies the site ─────────────────────────────────────────────
 *
 * Monetag's own "file" verification wants `sw.js` at the site root — impossible
 * here, that path is the PWA service worker (offline / push / install). Monetag's
 * "code" method instead looks for this tag in the served HTML, so server-
 * rendering it (like the AdSense site script) satisfies verification too. A
 * meta-tag method, if Monetag offers one, is covered by `verificationTags`.
 *
 * ── Server-rendered + async ───────────────────────────────────────────────────
 *
 * Server-rendered so Monetag's crawler sees it; `async` so it never blocks the
 * parser or the LCP. CSP already allows it — `script-src` includes `https:` and
 * the standing rule is that ads must never be CSP-blocked.
 */
export async function MonetagScript() {
  const settings = await getMonetizationSettings();
  if (!settings.monetag) return null;

  const snippet = (settings.monetagSnippet ?? "").trim();
  if (!snippet) return null;

  const srcMatch = snippet.match(/src\s*=\s*["']([^"']+)["']/i);
  let src = (srcMatch?.[1] ?? "").trim();
  if (src.startsWith("//")) src = `https:${src}`;
  // Only a clean https script URL — never inline code or markup.
  if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) return null;

  const zone = snippet.match(/data-zone\s*=\s*["']?(\d{1,20})["']?/i)?.[1];
  const cfAsync = /data-cfasync\s*=\s*["']?false["']?/i.test(snippet);

  return (
    <script
      async
      src={src}
      {...(zone ? { "data-zone": zone } : {})}
      {...(cfAsync ? { "data-cfasync": "false" } : {})}
    />
  );
}
