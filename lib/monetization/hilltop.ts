/**
 * HilltopAds — snippet parser and placement model.
 *
 * Owner, 2026-09-01: "exoclick is complicated, we will switch to hiltop ad …
 * set up the ad to be used in those places where exoclick are used, and we will
 * also use hiltop vast video and video slider too."
 *
 * ── How a Hilltop tag places itself, and why that changes everything ──────────
 *
 * Their snippet is a self-executing loader:
 *
 *     var d = document, s = d.createElement('script'),
 *         l = d.scripts[d.scripts.length - 1];
 *     s.settings = {};
 *     s.src = "//massivesalad.com/bxXFV.sWdLG/…";
 *     s.async = true;
 *     s.referrerPolicy = 'no-referrer-when-downgrade';
 *     l.parentNode.insertBefore(s, l);
 *
 * Read the third line: `l` is the LAST script in the document at the moment the
 * snippet runs — which, for a tag pasted inline, is the snippet's own `<script>`.
 * It then inserts the real loader immediately before itself. So a Hilltop unit
 * renders WHERE ITS SCRIPT TAG SITS IN THE DOM.
 *
 * 🔴 THAT IS THE OPPOSITE OF EXOCLICK, and it is the whole reason this file is
 * short. ExoClick needs an `<ins class="eas…" data-zoneid="…">` placeholder, its
 * loader finds every placeholder on the page and asks for all of them in ONE
 * batched request, and it refuses to serve one zone twice in that request — the
 * rule that cost a day of revenue on 2026-09-01. Hilltop has no placeholder and
 * no batch: each script tag is its own request, made where it stands. Nothing
 * here needs a zone claim, a duplicate warning, or one-zone-per-placement.
 *
 * ── Parsed, never injected ────────────────────────────────────────────────────
 *
 * Same discipline as `parseMonetagSnippet` and `verificationTags`: the pasted
 * text never reaches the DOM. Only a clean `https` script URL is lifted out of
 * it and re-emitted as a real `<script>` element with the attributes their
 * loader would have set. An admin free-text field rendered as markup is a
 * stored-XSS primitive with a friendly name.
 */

/** One parsed Hilltop tag: the loader URL, and the attributes it expects. */
export interface HilltopTag {
  /** The `https` loader URL lifted out of the snippet. */
  src: string;
  /**
   * Their loader sets `referrerPolicy = 'no-referrer-when-downgrade'` on the
   * script it inserts. Carried through rather than assumed: it is what the
   * network expects to receive, and a stricter policy loses the referer their
   * reporting is keyed on.
   */
  referrerPolicy: "no-referrer-when-downgrade";
}

/**
 * Read a Hilltop snippet into `{ src }`, or null if it cannot be read safely.
 *
 * Handles the ESCAPED form their dashboard hands out — the src arrives as
 * `"\/\/massivesalad.com\/bxXFV…"`, with every slash backslash-escaped because
 * it is a JavaScript string literal. Unescaping that is not cosmetic: without
 * it the URL fails the shape test below and a perfectly good tag resolves to
 * nothing, which on screen is indistinguishable from a network with no demand.
 *
 * ⚠️ NO HOST ALLOWLIST, deliberately, and this is the one place this file
 * differs from `parseExoClickSticky`. Hilltop serves every publisher from its
 * own rotating domain — `massivesalad.com` here — and rotates them to survive
 * blocklists. An allowlist would turn a routine domain rotation into "all our
 * ads silently stopped", which is exactly the failure mode this codebase keeps
 * having to diagnose. The shape is constrained instead: https only, a real
 * host, and no characters that could break out of the attribute.
 */
/** https, and nothing that could break out of a src attribute. */
const SAFE_SRC = /^https:\/\/[^\s"'<>\\]+$/i;

export function parseHilltopTag(snippet: string | null | undefined): HilltopTag | null {
  const raw = (snippet ?? "").trim();
  if (!raw) return null;

  // `s.src = "…"` or a plain `src="…"`, whichever form was pasted.
  const match = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  let src = (match?.[1] ?? "").trim();
  if (!src) return null;

  // The JS-string escaping their dashboard emits: every `/` arrives as `\/`.
  src = src.split("\\/").join("/");
  // Protocol-relative is their default. Resolve it UP to https, never down.
  if (src.startsWith("//")) src = `https:${src}`;

  if (!SAFE_SRC.test(src)) return null;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return null;
    // A bare host with no path is not a tag, it is a typo that would load a
    // homepage into a script element.
    if (!url.hostname.includes(".") || url.pathname.length < 2) return null;
  } catch {
    return null;
  }

  return { src, referrerPolicy: "no-referrer-when-downgrade" };
}

/**
 * Read a Hilltop VAST tag URL, or null.
 *
 * A VAST tag is a bare URL, not a script block — their dashboard hands it over
 * as `https://vapid-size.com/d/…` with nothing around it. So it is validated as
 * a URL rather than parsed out of markup, and the same shape rules apply: https
 * only, a real host, a real path.
 *
 * Kept in this file rather than beside the VAST player because what makes it a
 * HILLTOP tag is the domain it comes from, and that is a network fact, not a
 * player one.
 */
export function parseHilltopVastUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (!SAFE_SRC.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.pathname.length < 2) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Where a Hilltop BANNER may be placed.
 *
 * The same positions the ExoClick snippet slots occupy, because that is what
 * was asked for — "set up the ad to be used in those places where exoclick are
 * used". Each reports separately to the admin activity feed, so an operator can
 * see which position is earning rather than one lumped number.
 */
export const HILLTOP_BANNER_SLOTS = ["history", "historyfeed", "landing", "feed"] as const;

export type HilltopBannerSlot = (typeof HILLTOP_BANNER_SLOTS)[number];
