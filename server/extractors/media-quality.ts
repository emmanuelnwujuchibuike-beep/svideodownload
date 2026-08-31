/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE THAT DECIDES WHICH RENDITION WE DOWNLOAD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every platform hands us the SAME picture or clip several times over at
 * different sizes, and every extractor used to choose between them in its own
 * way — sorted by width here, "first match wins" there, `og:image` first
 * somewhere else. Three of those choices were wrong, and each was invisible:
 * the file downloads fine, it is just smaller than the one the platform was
 * willing to give us.
 *
 * Audited 2026-08-31, with what each cost:
 *
 *  • **Pinterest** asked for `og:image` BEFORE the pin's `orig` URL. Pinterest's
 *    `og:image` is the `i.pinimg.com/736x/…` share rendition; `orig` is
 *    `i.pinimg.com/originals/…`, the file the pinner uploaded. Every Pinterest
 *    photo download took the 736px preview while the original sat one branch
 *    below it.
 *  • **Threads** matched candidates with
 *    `"image_versions2":\{"candidates":\[\{"[^}]*?"url":"…"`, which consumes the
 *    opening quote of the first key and then needs ANOTHER `"url":"` before the
 *    first `}`. `[^}]` cannot cross that brace, so the moment `url` IS the first
 *    key — which is how Meta emits it — the pattern cannot match at all. Every
 *    Threads photo therefore fell through to `display_url` (the resized display
 *    copy) or to `og:image` (the share preview).
 *  • **Instagram** picked `video_versions.find(first with an http url)` while
 *    its images were correctly sorted by width. Meta usually orders those
 *    largest-first, but "usually" is what the image path already refused to
 *    rely on.
 *
 * So the ranking lives here, once, and the extractors call it. Nothing in this
 * module fetches anything: every decision is made from metadata the extraction
 * already has, which is what keeps "pick the best" free.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 *
 * It never reorders DISTINCT items. Photo 2 of a carousel is not a worse
 * version of Photo 1, and sorting a post's media by size would scramble the
 * order the person is looking at. Ranking applies only WITHIN the set of
 * renditions of one piece of media — see `quality-ladder.ts`, which keeps the
 * same rule for video tiers vs `isSeparateItem` entries.
 */

/** A rendition as the Meta/Instagram/Threads JSON describes one. */
export interface SizedCandidate {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * The widest rendition, or null.
 *
 * Falls back to height when width is absent, because Meta omits one or the
 * other on some payloads, and a rendition described by neither must never
 * outrank one that is described — an unknown size is not a big size.
 */
export function pickWidest<T extends SizedCandidate>(candidates: readonly T[] | undefined | null): T | null {
  const usable = (candidates ?? []).filter((c) => typeof c?.url === "string" && c.url!.startsWith("http"));
  if (usable.length === 0) return null;
  return usable
    .slice()
    .sort((a, b) => sizeOf(b) - sizeOf(a))[0]!;
}

function sizeOf(c: SizedCandidate): number {
  const w = typeof c.width === "number" && c.width > 0 ? c.width : 0;
  const h = typeof c.height === "number" && c.height > 0 ? c.height : 0;
  // Longest edge, so a portrait 1080x1350 outranks a landscape 1080x608 rather
  // than tying with it, and an undescribed rendition scores 0 (see above).
  return Math.max(w, h);
}

/**
 * Size hints CDNs put in the path or query, biggest-first, and the markers that
 * mean "this is the untouched upload".
 *
 * These are RANKING hints, never measurements — the same caveat
 * `facebook.ts:declaredSize` documents at length. A URL that claims 1440 may
 * deliver less; what matters is only that it claims MORE than one claiming 640.
 */
const ORIGINAL_MARKERS = [/\/originals?\//i, /[?&]__?orig/i, /\/orig\//i];

/** Longest edge a URL advertises, or 0 when it advertises nothing. */
export function declaredUrlSize(url: string): number {
  let best = 0;
  // i.pinimg.com/736x/…, /1200x/, /236x/ — Pinterest's rendition folders.
  for (const [, n] of url.matchAll(/\/(\d{2,5})x(?:\d{2,5})?\//g)) best = Math.max(best, Number(n) || 0);
  // Meta's stp/cstp/ctp crop hints: p1080x1350, s640x640, mx720x1280.
  for (const [, a, b] of url.matchAll(/[psmx](\d{2,5})x(\d{2,5})/gi)) {
    best = Math.max(best, Number(a) || 0, Number(b) || 0);
  }
  // Explicit dimension query parameters.
  for (const [, n] of url.matchAll(/[?&](?:w|width|h|height)=(\d{2,5})\b/gi)) best = Math.max(best, Number(n) || 0);
  return best;
}

/** Does this URL look like the untouched upload rather than a rendition? */
export function looksOriginal(url: string): boolean {
  return ORIGINAL_MARKERS.some((re) => re.test(url));
}

/**
 * Rank image URLs best-first when they are renditions OF THE SAME PICTURE.
 *
 * Order: an explicit "original" marker beats everything (a Pinterest
 * `/originals/` URL carries no size hint at all, and must still outrank a
 * `/736x/` one that does); then the largest declared size; then the order they
 * arrived in, so a tie never reshuffles anything.
 *
 * ⚠️ Only ever call this on alternates of ONE image. Passing a carousel's
 * distinct photos through it would reorder the post.
 */
export function rankRenditions(urls: readonly string[]): string[] {
  return urls
    .map((url, index) => ({ url, index }))
    .sort((a, b) => {
      const oa = looksOriginal(a.url) ? 1 : 0;
      const ob = looksOriginal(b.url) ? 1 : 0;
      if (oa !== ob) return ob - oa;
      const da = declaredUrlSize(a.url);
      const db = declaredUrlSize(b.url);
      if (da !== db) return db - da;
      return a.index - b.index;
    })
    .map((e) => e.url);
}

/**
 * Every `image_versions2` block in a Meta page payload, each reduced to its
 * widest candidate — in page order, so a carousel keeps its order.
 *
 * Written as a scan rather than one regex because the regex this replaces was
 * unmatchable in exactly the shape Meta emits (see the header). Each block is
 * located first, then its candidate objects are read individually, so key
 * ORDER inside a candidate is irrelevant — which is the property the old
 * pattern accidentally depended on.
 */
export function metaImageCandidates(html: string): { url: string; width: number }[] {
  return metaVersionCandidates(html, /"image_versions2"\s*:\s*\{\s*"candidates"\s*:\s*\[/g);
}

/**
 * The same scan for `video_versions`, which Meta shapes identically — an array
 * of `{url,width,height}` renditions.
 *
 * `threads.ts` read these with `"video_versions":\[\{"[^}]*?"url":"…"`, the
 * exact pattern documented in the header as unmatchable when `url` is the first
 * key, and it would have taken the FIRST rendition rather than the largest even
 * if it had matched.
 */
export function metaVideoCandidates(html: string): { url: string; width: number }[] {
  return metaVersionCandidates(html, /"video_versions"\s*:\s*\[/g);
}

function metaVersionCandidates(html: string, blockRe: RegExp): { url: string; width: number }[] {
  const out: { url: string; width: number }[] = [];
  const blocks = html.matchAll(blockRe);
  for (const block of blocks) {
    const start = block.index! + block[0].length;
    // Bounded slice: a candidates array is small, and this avoids scanning the
    // rest of a multi-megabyte page for a closing bracket that may be absent
    // in a truncated response.
    const slice = html.slice(start, start + 8000);
    const end = slice.indexOf("]");
    const arr = end >= 0 ? slice.slice(0, end) : slice;
    const candidates: SizedCandidate[] = [];
    for (const obj of arr.matchAll(/\{[^{}]*\}/g)) {
      const body = obj[0];
      const url = body.match(/"url"\s*:\s*"([^"]+)"/)?.[1];
      if (!url) continue;
      candidates.push({
        url,
        width: Number(body.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0) || null,
        height: Number(body.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0) || null,
      });
    }
    const best = pickWidest(candidates);
    if (best?.url) out.push({ url: best.url, width: sizeOf(best) });
  }
  return out;
}
