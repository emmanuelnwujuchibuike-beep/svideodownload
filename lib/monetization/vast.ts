/**
 * A minimal VAST reader — enough of the spec to play one linear video ad.
 *
 * ── Why this exists at all ────────────────────────────────────────────────────
 *
 * ExoClick sells two completely different products behind the same "zone id",
 * and the difference is invisible from the number:
 *
 *   • a DISPLAY zone, delivered by `ad-provider.js` filling an
 *     `<ins class="eas…">` placeholder, and
 *   • a VIDEO zone, delivered as VAST XML from `s.magsrv.com/v1/vast.php`,
 *     which is inert without a player that can read it.
 *
 * The first implementation assumed the display tag. The owner's zone is a video
 * zone, so `ad-provider.js` loaded, called its API, matched no placeholder it
 * recognised, and rendered nothing — with no error on any surface. Since the ask
 * was for vertical VIDEO ads from the start, VAST is the correct pipeline and
 * this is the piece that was missing.
 *
 * ── Deliberately regex, not an XML dependency ─────────────────────────────────
 *
 * The brief said not to add unnecessary dependencies, and this reads five
 * element types out of a document we fetch from one known vendor. A full XML
 * parser is a lot of surface area for that. The trade is real and bounded:
 * these patterns would not survive arbitrary XML, and every extractor below
 * fails to `null`/`[]` rather than throwing, so a shape we do not understand
 * degrades to "no ad" instead of breaking the page.
 *
 * Pure and DOM-free on purpose — it runs server-side (see the proxy route) and
 * is unit-tested there.
 */

export interface VastCreative {
  /** Direct media URL, playable in a `<video>`. */
  mediaUrl: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  /**
   * The other renditions of this same creative, best-first.
   *
   * 🔴 THE IMPRESSION DEPENDS ON SOMETHING DECODING. `overlay.ts` fires
   * `<Impression>` from the video's `playing` event — correct, because a pixel
   * sent before the first frame is a lie the network can charge back — which
   * means a rendition this device cannot decode costs the impression entirely,
   * silently. Hilltop ships webm/mp4/flv of every creative, and WebKit refuses
   * the WebM, so "the media did not decode" is a routine event, not an edge
   * case. Carrying the alternatives lets the player try the next one instead of
   * giving up on the ad.
   */
  fallbacks: { url: string; type: string }[];
  /** Seconds, from `<Duration>`. Null when absent or unparseable. */
  durationSeconds: number | null;
  /** Fired once, when playback actually begins. */
  impressions: string[];
  /** VAST `<Tracking event="…">` pixels, keyed by event name. */
  tracking: Record<string, string[]>;
  /**
   * 🔴 `<Tracking event="progress" offset="…">` — THE VIEW COUNTER.
   *
   * This is why ExoClick reported ~100 impressions, 0 views and $0.00. Their
   * VAST carries no `start` or quartile events at all: every tracker is
   * `event="progress"` with a time offset, and the URL behind it is
   * `vregister.php?a=vview` — literally their view beacon. Keying trackers by
   * event NAME alone collapsed all five into an unused `progress` bucket, so
   * the impression pixel (`a=vimp`) fired correctly and the view pixel never
   * fired once.
   *
   * Kept separate from `tracking` because these are the one event type whose
   * firing time comes from the XML rather than from a fixed milestone.
   */
  progress: { offsetSeconds: number; url: string }[];
  /** Where a click on the ad goes. */
  clickThrough: string | null;
  /** Fired alongside a click. */
  clickTracking: string[];
  /**
   * OUR ad row id, attached by `/api/ads/exoclick` — not part of the VAST.
   *
   * Optional because `parseVast` never sets it: the parser only knows what the
   * network sent. The route adds it on the way out so the client can attribute a
   * click in our own analytics, and it is a synthetic label rather than a uuid
   * for shared-mode slots, which have no row.
   */
  adId?: string;
  /**
   * A hold imposed by the VISITOR'S PLAN, overriding the admin's number.
   *
   * Set only by `/api/ads/exoclick`, and today only for Pro — the owner's
   * "5secs download complete" exception, which is the single ad a Pro member
   * ever sees. Not part of the VAST; `parseVast` never sets it.
   *
   * 🔴 IT TRAVELS WITH THE CREATIVE BECAUSE IT IS PER-VISITOR. The public ad
   * config is served `Cache-Control: public, max-age=60` — a shared cache — so
   * an entitlement placed there would be handed to whoever asked next. This
   * response is `private, no-store`, which makes it the only correct carrier.
   */
  skipAfterSeconds?: number;
  /**
   * Whether to show the "Tired of ads? Go Pro" link on the overlay.
   *
   * Set by `/api/ads/exoclick` from the visitor's plan, never inferred on the
   * client: a Pro member DOES still see one ad (the 5s completion video), and
   * selling them the plan they already bought inside it would be the worst copy
   * on the site. Absent is treated as false, so a stale client cannot show it.
   */
  offerUpgrade?: boolean;
}

/** Pull the text out of an element, whether it is CDATA-wrapped or bare. */
function textOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const value = (cdata?.[1] ?? raw).trim();
  return value || null;
}

function allTags(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  for (const m of xml.matchAll(re)) {
    const value = textOf(m[1]);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Only http(s), and nothing else.
 *
 * Every URL here comes from a third party and is about to be handed to
 * `new Image().src` or `window.open`. A `javascript:` payload in a
 * `<ClickThrough>` would otherwise be a straight XSS via the ad network.
 */
function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const safeUrls = (values: string[]): string[] =>
  values.map(safeUrl).filter((v): v is string => !!v);

/** `00:00:20.736` → 20.736 */
export function parseVastDuration(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, s, frac] = m;
  const total =
    Number(h) * 3600 + Number(min) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0);
  return Number.isFinite(total) ? total : null;
}

/**
 * A `progress` tracker's offset, in seconds.
 *
 * VAST 3.0 allows two forms and ExoClick uses the first: `"00:00:03.000"`, or a
 * percentage of duration such as `"50%"`. The percentage form needs a known
 * duration — without one it returns null rather than guessing, because these
 * beacons are what the advertiser is billed on.
 */
export function parseVastOffset(
  value: string | null,
  durationSeconds: number | null,
): number | null {
  if (!value) return null;
  const raw = value.trim();
  const pct = raw.match(/^(\d{1,3})\s*%$/);
  if (pct) {
    if (!durationSeconds) return null;
    return (Number(pct[1]) / 100) * durationSeconds;
  }
  return parseVastDuration(raw);
}

/**
 * The best media file for a vertical slot.
 *
 * Prefers a progressive MP4 — the only combination every browser can play from
 * a plain `<video src>` without an extra streaming library. Among those, the
 * TALLEST is chosen, because these placements are 9:16 and a landscape
 * rendition letterboxes into a thin band inside them.
 */
function pickMedia(xml: string): {
  url: string;
  type: string;
  w: number | null;
  h: number | null;
  fallbacks: { url: string; type: string }[];
} | null {
  const candidates: { url: string; type: string; w: number | null; h: number | null; delivery: string }[] = [];

  for (const m of xml.matchAll(/<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi)) {
    const attrs = m[1] ?? "";
    const url = safeUrl(textOf(m[2]));
    if (!url) continue;
    const attr = (name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";
    const num = (name: string) => {
      const n = Number(attr(name));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    candidates.push({
      url,
      type: (attr("type") || "video/mp4").toLowerCase(),
      w: num("width"),
      h: num("height"),
      delivery: attr("delivery").toLowerCase(),
    });
  }

  if (candidates.length === 0) return null;

  /*
    🔴 FLV IS NOT PLAYABLE ANYWHERE. It is Flash video; no browser has decoded it
    for years, and HilltopAds still offers one in every pod. Leaving it in the
    pool meant it could be selected as a last resort and guarantee a dead frame.
  */
  const playable = candidates.filter(
    (c) => c.type === "video/mp4" || c.type === "video/webm" || c.type === "",
  );
  if (playable.length === 0) return null;

  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 MP4 FIRST — AND UNTIL 2026-09-02 THIS FUNCTION DID NOT DO IT
    ═══════════════════════════════════════════════════════════════════════════

    The comment above has always claimed it "prefers a progressive MP4 — the only
    combination every browser can play from a plain `<video src>`". The sort did
    not implement that. It ordered by delivery, then by HEIGHT, and nothing else.

    Hilltop's pods offer webm/mp4/flv renditions of the SAME creative at the SAME
    dimensions — 1280x720 across all three. Equal height means the comparator
    returns 0, `Array.prototype.sort` is stable, and the winner is therefore
    whichever appeared first in the XML. Hilltop lists WebM first. So every
    visitor was handed a WebM.

    ── Why that reads as "the VAST records no impressions at all" ──────────────

    `overlay.ts` fires `<Impression>` and `<Tracking event="start">` from the
    video element's `playing` event — correctly, because an impression that fires
    before the first frame is a lie the network can charge back. But Safari and
    every iOS browser (all of which are WebKit) cannot decode VP8/VP9 in a
    `<video src>`. The element never reaches `playing`, so no pixel is ever sent:
    not the impression, not the start, nothing. On a mobile downloader the iOS
    share is large enough that the dashboard reads as a flat zero.

    MP4/H.264 is the one container-codec pair that plays on every browser this
    site supports, so it is now an explicit FIRST-CLASS sort key rather than an
    aspiration in a comment. Height only breaks ties within a format.
  */
  const rank = (c: (typeof playable)[number]) => {
    if (c.type === "video/mp4") return 0;
    // An untyped MediaFile is usually MP4 in practice, and is worth trying
    // before a WebM that WebKit is known to refuse.
    if (c.type === "") return 1;
    return 2; // webm
  };

  playable.sort((a, b) => {
    // Progressive first — a streaming delivery needs a library we do not ship.
    const prog = (c: typeof a) => (c.delivery === "progressive" ? 0 : 1);
    if (prog(a) !== prog(b)) return prog(a) - prog(b);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (b.h ?? 0) - (a.h ?? 0);
  });

  const best = playable[0]!;
  return {
    url: best.url,
    type: best.type || "video/mp4",
    w: best.w,
    h: best.h,
    /*
      The rest of the pool, best-first, so a rendition that fails to decode on
      this particular device can be retried instead of costing the impression.
      One dead codec must not end the ad.
    */
    fallbacks: playable.slice(1).map((c) => ({ url: c.url, type: c.type || "video/mp4" })),
  };
}

/**
 * The next VAST document to fetch, when this one is a Wrapper rather than an ad.
 *
 * Wrappers are how resellers chain to the real creative — common enough that
 * ignoring them would mean silently dropping a share of the fill.
 */
export function vastWrapperUrl(xml: string): string | null {
  const m = xml.match(/<VASTAdTagURI\b[^>]*>([\s\S]*?)<\/VASTAdTagURI>/i);
  return safeUrl(textOf(m?.[1]));
}

/** Read one linear creative out of an InLine VAST document. */
export function parseVast(xml: string): VastCreative | null {
  if (!xml || !/<VAST\b/i.test(xml)) return null;

  const media = pickMedia(xml);
  if (!media) return null;

  const durationSeconds = parseVastDuration(
    xml.match(/<Duration\b[^>]*>([\s\S]*?)<\/Duration>/i)?.[1]?.trim() ?? null,
  );

  const tracking: Record<string, string[]> = {};
  const progress: { offsetSeconds: number; url: string }[] = [];
  for (const m of xml.matchAll(/<Tracking\b([^>]*)>([\s\S]*?)<\/Tracking>/gi)) {
    const attrs = m[1] ?? "";
    const event = attrs.match(/event\s*=\s*"([^"]*)"/i)?.[1];
    const url = safeUrl(textOf(m[2]));
    if (!event || !url) continue;

    if (event.toLowerCase() === "progress") {
      const offsetSeconds = parseVastOffset(
        attrs.match(/offset\s*=\s*"([^"]*)"/i)?.[1] ?? null,
        durationSeconds,
      );
      // An offset we cannot read is dropped rather than guessed at: firing a
      // view beacon at the wrong moment is worse than not firing it, because it
      // is the number the advertiser is billed on.
      if (offsetSeconds !== null) progress.push({ offsetSeconds, url });
      continue;
    }
    (tracking[event] ??= []).push(url);
  }
  progress.sort((a, b) => a.offsetSeconds - b.offsetSeconds);

  return {
    mediaUrl: media.url,
    mediaType: media.type,
    width: media.w,
    height: media.h,
    fallbacks: media.fallbacks,
    durationSeconds,
    impressions: safeUrls(allTags(xml, "Impression")),
    tracking,
    progress,
    clickThrough: safeUrl(allTags(xml, "ClickThrough")[0] ?? null),
    clickTracking: safeUrls(allTags(xml, "ClickTracking")),
  };
}

/** The VAST endpoint for an ExoClick zone id. */
export function exoClickVastUrl(zoneId: string): string {
  return `https://s.magsrv.com/v1/vast.php?idzone=${encodeURIComponent(zoneId)}`;
}
