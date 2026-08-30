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
}

/** ExoClick's loader. Shared with any other ExoClick display placement. */
export const EXOCLICK_PROVIDER_SRC = "https://a.magsrv.com/ad-provider.js";

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

  return { cls, zoneId };
}
