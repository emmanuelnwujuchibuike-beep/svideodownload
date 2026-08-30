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
  /** Seconds, from `<Duration>`. Null when absent or unparseable. */
  durationSeconds: number | null;
  /** Fired once, when playback actually begins. */
  impressions: string[];
  /** VAST `<Tracking event="…">` pixels, keyed by event name. */
  tracking: Record<string, string[]>;
  /** Where a click on the ad goes. */
  clickThrough: string | null;
  /** Fired alongside a click. */
  clickTracking: string[];
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
 * The best media file for a vertical slot.
 *
 * Prefers a progressive MP4 — the only combination every browser can play from
 * a plain `<video src>` without an extra streaming library. Among those, the
 * TALLEST is chosen, because these placements are 9:16 and a landscape
 * rendition letterboxes into a thin band inside them.
 */
function pickMedia(xml: string): { url: string; type: string; w: number | null; h: number | null } | null {
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

  const playable = candidates.filter(
    (c) => c.type === "video/mp4" || c.type === "video/webm" || c.type === "",
  );
  const pool = playable.length > 0 ? playable : candidates;

  pool.sort((a, b) => {
    // Progressive first — a streaming delivery needs a library we do not ship.
    const prog = (c: typeof a) => (c.delivery === "progressive" ? 0 : 1);
    if (prog(a) !== prog(b)) return prog(a) - prog(b);
    return (b.h ?? 0) - (a.h ?? 0);
  });

  const best = pool[0]!;
  return { url: best.url, type: best.type || "video/mp4", w: best.w, h: best.h };
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

  const tracking: Record<string, string[]> = {};
  for (const m of xml.matchAll(/<Tracking\b([^>]*)>([\s\S]*?)<\/Tracking>/gi)) {
    const event = m[1]?.match(/event\s*=\s*"([^"]*)"/i)?.[1];
    const url = safeUrl(textOf(m[2]));
    if (!event || !url) continue;
    (tracking[event] ??= []).push(url);
  }

  return {
    mediaUrl: media.url,
    mediaType: media.type,
    width: media.w,
    height: media.h,
    durationSeconds: parseVastDuration(
      xml.match(/<Duration\b[^>]*>([\s\S]*?)<\/Duration>/i)?.[1]?.trim() ?? null,
    ),
    impressions: safeUrls(allTags(xml, "Impression")),
    tracking,
    clickThrough: safeUrl(allTags(xml, "ClickThrough")[0] ?? null),
    clickTracking: safeUrls(allTags(xml, "ClickTracking")),
  };
}

/** The VAST endpoint for an ExoClick zone id. */
export function exoClickVastUrl(zoneId: string): string {
  return `https://s.magsrv.com/v1/vast.php?idzone=${encodeURIComponent(zoneId)}`;
}
