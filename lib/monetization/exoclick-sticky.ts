/**
 * ExoClick STICKY BANNER — a display zone, kept apart from every other banner.
 *
 * ── Why it is its own thing and not an ad row ─────────────────────────────────
 *
 * Owner, 2026-08-30: "set a slot in admin dashboard where i can configure
 * exoclick sticky banner, separate it from other banners."
 *
 * It genuinely is a different product from the zones already modelled:
 *
 *  • The five ExoClick VIDEO zones answer on `vast.php` and are played by our
 *    own `<video>`. This one is ExoClick's DISPLAY product, filled by their
 *    `ad-provider.js` into an `<ins>` placeholder.
 *  • It places ITSELF, pinned to the viewport by ExoClick's own script. It has
 *    no slot in the page's layout, so it does not belong in `AD_ZONES`, whose
 *    whole premise is "where on the page does this go".
 *
 * ── Parsed, never injected ────────────────────────────────────────────────────
 *
 * The operator pastes the snippet from the ExoClick dashboard and this reads two
 * values out of it. The markup itself never reaches the DOM — same rule as
 * `parseMonetagSnippet` and the verification tags: an admin free-text field
 * rendered as HTML is a stored-XSS primitive with a friendly name.
 *
 * 🔴 The CLASS IS PARSED, not assumed. The first ExoClick work hardcoded
 * `eas6a97888e`, and the owner's sticky zone turned out to be `eas6a97888e17` —
 * the suffix differs per tag. A hardcoded class means their loader silently
 * ignores the placeholder and nothing renders, with no error anywhere, which is
 * exactly how the first ExoClick integration failed.
 */

export interface ExoClickStickyTag {
  /** The `<ins>` class ExoClick's loader looks for. */
  cls: string;
  /** The numeric zone id. */
  zoneId: string;
  /**
   * The loader this tag was issued with.
   *
   * 🔴 NOT ALWAYS magsrv (owner, 2026-08-31, pasting a fullpage-interstitial
   * tag served from `a.pemsrv.com`). ExoClick hands out the same provider from
   * several domains, and a snippet's own domain is the one its zone was
   * activated against — substituting ours for theirs is the same class of
   * mistake as hardcoding the `<ins>` class was.
   *
   * Absent when the snippet carried no script tag, in which case the caller
   * falls back to `EXOCLICK_PROVIDER_SRC`.
   */
  src?: string;
}

/** ExoClick's loader. The default when a pasted snippet names no other. */
export const EXOCLICK_PROVIDER_SRC = "https://a.magsrv.com/ad-provider.js";

/**
 * Hosts a pasted snippet may load its loader from.
 *
 * An allowlist, not a pattern: this value ends up as the `src` of a `<script>`
 * in the top-level document, so "whatever the operator pasted" is a
 * remote-code-execution field with a friendly name. These are ExoClick's own
 * provider domains (they rotate them to survive blocklists); anything else
 * falls back to the default rather than being honoured.
 */
const PROVIDER_HOSTS = new Set([
  "a.magsrv.com",
  "a.pemsrv.com",
  "a.exdynsrv.com",
  "a.realsrv.com",
  "a.exoclick.com",
]);

/** The provider URL a snippet names, if it names an allowed one. */
export function parseProviderSrc(snippet: string): string | undefined {
  const raw = snippet.match(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw, "https://a.magsrv.com");
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!PROVIDER_HOSTS.has(url.hostname)) return undefined;
  if (!/\/ad-provider\.js$/.test(url.pathname)) return undefined;
  return url.toString();
}

/**
 * Read `{ cls, zoneId }` out of a pasted ExoClick zone snippet.
 *
 * Returns null for anything it cannot read with confidence — a half-understood
 * tag must render nothing rather than an `<ins>` that quietly never fills.
 */
export function parseExoClickSticky(snippet: string | null | undefined): ExoClickStickyTag | null {
  if (!snippet || typeof snippet !== "string") return null;

  // Tolerates either attribute order, single or double quotes, and the
  // whitespace/newlines the dashboard's copy button includes.
  const cls = snippet.match(/<ins\b[^>]*\bclass\s*=\s*["']([A-Za-z0-9_-]{4,64})["']/i)?.[1];
  const zoneId = snippet.match(/<ins\b[^>]*\bdata-zoneid\s*=\s*["'](\d{4,20})["']/i)?.[1];
  if (!cls || !zoneId) return null;

  /*
    The class must look like ExoClick's own placeholder rather than any class the
    operator happened to paste — this value is written into a live `class`
    attribute, so it is bounded to their `eas…` shape and to safe characters.
  */
  if (!/^eas[a-z0-9]+$/i.test(cls)) return null;

  return { cls, zoneId, src: parseProviderSrc(snippet) };
}
