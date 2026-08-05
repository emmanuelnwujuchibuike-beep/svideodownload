import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Snapchat custom extractor — handles **Spotlight** clips AND public **Story**
 * pages (snapchat.com/@user, /p/, /spotlight/, /t/ share links). Media comes
 * from the page's `__NEXT_DATA__` blob:
 *   - Spotlight → `props.pageProps.videoMetadata.contentUrl`
 *   - Story     → `props.pageProps.story.snapList[].snapUrls.mediaUrl`
 * Spotlight's `contentUrl` is the watermarked share render, so we rewrite it to
 * the clean rendition (see `stripSnapWatermark`). Stories are already clean.
 * Using these direct CDN URLs gives a no-watermark download with no transcode,
 * which yt-dlp's Spotlight extractor cannot do (it returns a watermarked render).
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1";

const TIMEOUT_MS = Number(process.env.SNAPCHAT_EXTRACTOR_TIMEOUT_MS || 9000);

export interface Snap {
  snapId?: string;
  snapMediaType?: number;
  snapTitle?: string;
  timestampInSec?: number | string;
  snapUrls?: { mediaUrl?: string; mediaPreviewUrl?: string };
}

interface VideoMeta {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  contentUrl?: string;
  durationMs?: number;
  viewCount?: number | string;
  creator?: unknown;
}

/**
 * Every snap anywhere in the `__NEXT_DATA__` blob, in document order.
 *
 * ── Why a deep walk instead of reading known keys ─────────────────────────────
 * Snapchat puts snaps in a different container depending on what the page IS:
 * `story.snapList` for a live 24-hour story, `curatedHighlights[].snapList` for
 * highlights, and other shapes again for a SAVED story folder on a profile (the
 * "My Obsession" case the owner hit). Reading a fixed list of keys meant a
 * folder shape we hadn't seen produced NOTHING — the extractor fell through to a
 * regex that matches a single URL, which is exactly why a folder of many videos
 * downloaded one.
 *
 * Walking for the SHAPE of a snap (an object carrying `snapUrls.mediaUrl`)
 * instead of its location means a container being renamed or added no longer
 * breaks extraction. That is the right trade for a scraper: the page's structure
 * is outside our control and changes without warning, but what a snap looks like
 * is stable.
 *
 * De-duplicated on snapId (falling back to the media URL), because the same snap
 * legitimately appears more than once in the blob — a preview list plus the
 * folder itself, say. Depth- and count-capped so a hostile or pathological page
 * cannot spin the server.
 */
/**
 * The identity of a snap, for de-duplication.
 *
 * `snapId` when there is one. Otherwise the media URL with its QUERY STRING
 * STRIPPED — Snapchat's CDN links carry a signature and an expiry, so the same
 * snap appearing twice in the blob can arrive with two different full URLs.
 * Keying on the raw URL therefore de-duplicates nothing, which is how the same
 * video reached the picker several times over.
 */
function snapKey(s: Snap): string {
  if (typeof s.snapId === "string" && s.snapId) return s.snapId;
  const url = s.snapUrls?.mediaUrl ?? "";
  return url.split("?")[0] ?? url;
}

/** Drop repeats while preserving order. */
export function dedupeSnaps(snaps: readonly Snap[]): Snap[] {
  const seen = new Set<string>();
  const out: Snap[] = [];
  for (const s of snaps) {
    const key = snapKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function collectSnaps(root: unknown): Snap[] {
  const out: Snap[] = [];
  const seen = new Set<string>();
  const MAX_SNAPS = 200;
  const MAX_DEPTH = 12;

  const walk = (node: unknown, depth: number) => {
    if (out.length >= MAX_SNAPS || depth > MAX_DEPTH || !node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    const urls = obj.snapUrls as { mediaUrl?: unknown } | undefined;
    const mediaUrl = urls && typeof urls === "object" ? urls.mediaUrl : undefined;
    if (typeof mediaUrl === "string" && mediaUrl) {
      const key = snapKey(obj as Snap);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(obj as Snap);
      }
      // Don't return — a snap can nest further snaps in some page shapes.
    }

    for (const child of Object.values(obj)) walk(child, depth + 1);
  };

  walk(root, 0);
  return out;
}

/**
 * Does this URL address a COLLECTION (a profile, or a saved story folder)
 * rather than one specific snap?
 *
 * It matters because `matchSnap` narrows to a single snap when it can, and
 * narrowing is wrong for a folder: the owner asked for the folder, so they want
 * everything in it. A `/t/` short link is treated as a collection too — it
 * carries no snap id of its own, so any "match" against one would be a
 * coincidence between a short code and part of a snap id.
 */
export function isCollectionUrl(url: string): boolean {
  return /\/(?:@|p\/|t\/|add\/)/i.test(url) || /\/story\//i.test(url);
}

/** Find the snap the URL targets by matching its snapId anywhere in the link. */
function matchSnap(snaps: Snap[], url: string): Snap | null {
  let dec = url;
  try {
    dec = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  // 1) the snap's id appears verbatim in the URL (most reliable)
  const exact = snaps.find((s) => s.snapId && (url.includes(s.snapId) || dec.includes(s.snapId)));
  if (exact) return exact;
  // 2) a long token in the URL overlaps a snapId (handles wrapped/short ids)
  for (const t of dec.match(/[A-Za-z0-9_-]{16,}/g) ?? []) {
    const m = snaps.find((s) => s.snapId && (s.snapId.includes(t) || t.includes(s.snapId)));
    if (m) return m;
  }
  return null;
}

function snapFormat(snap: Snap, i: number, count: number): MediaFormat {
  const isVideo = snap.snapMediaType !== 0; // 1 = video, 0 = image
  const headers = { "User-Agent": MOBILE_UA, Referer: "https://www.snapchat.com/" };
  return {
    formatId: `snap-${i}`,
    kind: isVideo ? "video" : "image",
    label: count > 1 ? `Story ${i + 1}` : isVideo ? "Best quality" : "Photo",
    ext: isVideo ? "mp4" : "jpg",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: isVideo ? "h264" : null,
    acodec: isVideo ? "aac" : null,
    directUrl: stripSnapWatermark(cleanUrl(snap.snapUrls!.mediaUrl!)),
    httpHeaders: headers,
    // Each snap carries its own poster. Snapchat has always sent it; nothing
    // read it, so every tile in a multi-snap story showed the post's single
    // cover image and the batch picker was unusable.
    thumbnail: snap.snapUrls?.mediaPreviewUrl ? cleanUrl(snap.snapUrls.mediaPreviewUrl) : null,
    // A story with several snaps is several PIECES OF MEDIA, not several
    // qualities of one. Without this the UI treats them as a quality picker and
    // downloads only whichever is selected — the owner's "it only downloads the
    // first one". Flagged, they become a multi-select batch instead.
    isSeparateItem: count > 1,
  };
}

function cleanUrl(u: string): string {
  return unescapeJsonUrl(u.replace(/&amp;/g, "&"));
}

/**
 * Removes the Snapchat Spotlight watermark.
 *
 * Spotlight share pages serve a watermarked render: the media path uses the
 * `.27.` rendition and the `mo` (media-options) query embeds `SpotlightSharing`,
 * which tells the CDN to burn the "Snapchat / @username" overlay into the file.
 * The SAME media id + format token is also served clean at the `.1034.` (story
 * original) rendition. Swapping the rendition and dropping the watermark
 * media-option yields the identical clip with no overlay. Verified against live
 * Spotlight clips: `<id>.27.<tok>` (watermarked) vs `<id>.1034.<tok>` (clean).
 *
 * No-op for Story/image URLs (already clean), so it is safe to apply to every
 * Snapchat media URL. If the clean rendition is ever unavailable the proxy
 * download fails and the pipeline falls back to yt-dlp — never a broken file.
 */
export function stripSnapWatermark(u: string): string {
  try {
    const url = new URL(u);
    const mo = url.searchParams.get("mo") ?? "";
    const watermarked =
      /\.27\.[^./?#]+/.test(url.pathname) || // watermarked video rendition
      /U3BvdGxpZ2h0U2hhcmluZ/.test(mo); // base64 of "SpotlightSharing"
    if (!watermarked) return u;

    /*
      Rewrite the rendition to the clean `.1034.` original.

      ── The bug this fixes ──
      The path letter is NOT always `/d/`. This extractor's own fallback notes
      Spotlight serves from extension-less `/d/` OR `/y/` paths, but the rewrite
      only matched `/d/`, so a `/y/` Spotlight URL passed the watermark check and
      then had NOTHING rewritten — the download stayed watermarked. That is
      exactly "Snapchat Spotlight still downloads with watermarks".

      Generalised to any single-letter media directory, and anchored on the
      rendition segment (`.<digits>.`) rather than the id, so it does not depend
      on the id's characters. `.27.` is the watermarked share render; `.1034.` is
      the story original. Both fixed points are still assumptions about
      Snapchat's CDN — if they have changed the numbers wholesale, this needs a
      live watermarked URL to re-derive, and the pipeline falls back to yt-dlp
      rather than serving a broken file.
    */
    url.pathname = url.pathname.replace(/(\/[a-z]\/[^./]+)\.\d+\./i, "$1.1034.");
    url.searchParams.delete("mo");
    url.searchParams.delete("uc");
    return url.toString();
  } catch {
    return u;
  }
}

function creatorName(c: unknown): string | null {
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    return (
      (typeof o.name === "string" && o.name) ||
      (typeof o.username === "string" && o.username) ||
      null
    );
  }
  return null;
}

function videoFormat(mediaUrl: string): MediaFormat {
  return {
    formatId: "best",
    kind: "video",
    label: "Best quality",
    ext: "mp4",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: "h264",
    acodec: "aac",
    directUrl: mediaUrl,
    httpHeaders: { "User-Agent": MOBILE_UA, Referer: "https://www.snapchat.com/" },
  };
}

export const snapchatExtractor: Extractor = {
  name: "snapchat",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "snapchat";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        url,
        {
          headers: { "User-Agent": MOBILE_UA, "Accept-Language": "en-US,en;q=0.9" },
          redirect: "follow",
          signal: controller.signal,
        },
        "snapchat",
      );
      if (!res.ok) throw new ExtractionError(`Snapchat responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const blob = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );

    let mediaUrl: string | undefined;
    let title: string | undefined;
    let vm: VideoMeta | undefined;
    let formats: MediaFormat[] | undefined;

    if (blob) {
      try {
        const data = JSON.parse(blob[1]!) as {
          props?: { pageProps?: Record<string, unknown> };
        };
        const pp = (data.props?.pageProps ?? {}) as {
          videoMetadata?: VideoMeta;
          story?: { snapList?: Snap[] };
          curatedHighlights?: { snapList?: Snap[] }[];
        };

        // Spotlight (single video page) — the clean, no-watermark H.264 URL.
        if (pp.videoMetadata?.contentUrl) {
          vm = pp.videoMetadata;
          mediaUrl = pp.videoMetadata.contentUrl;
          title = pp.videoMetadata.name;
        }

        // Story page — return the EXACT snap the link points to. If we can't
        // identify it from the URL, return every snap so the user picks the
        // right one (instead of guessing and serving a random snap).
        if (!mediaUrl) {
          /*
            ── The live story and the highlight folders are NOT one list ──────
            Owner (2026-08-04): a normal story started returning every snap
            many times over — one snap showed as 12, six showed as 72.

            The cause was merging `story.snapList` with EVERY entry of
            `curatedHighlights`. Snapchat re-saves story snaps into highlight
            folders, so a profile with a live story and eleven highlights
            reports that story's snaps twelve times. The previous fix (read all
            the folders instead of only the first) was right for a SAVED FOLDER
            link and wrong for a plain story link, because it applied to both.

            The two cases are now separated by what the page actually contains:
            a live story wins when there is one, and the folders are only
            consulted when there is not — which is precisely the saved-folder
            page. Both lists are de-duplicated regardless, because the same snap
            can appear twice inside one container with two signed URLs.
          */
          const storySnaps = (Array.isArray(pp.story?.snapList) ? pp.story!.snapList! : []).filter(
            (s) => s?.snapUrls?.mediaUrl,
          );
          const highlightSnaps = (
            Array.isArray(pp.curatedHighlights)
              ? pp.curatedHighlights.flatMap((h) => (Array.isArray(h?.snapList) ? h.snapList : []))
              : []
          ).filter((s) => s?.snapUrls?.mediaUrl);

          const known = dedupeSnaps(storySnaps.length > 0 ? storySnaps : highlightSnaps);

          /*
            The deep walk is a LAST RESORT — only when the named containers
            yielded nothing at all.

            Owner (2026-08-04): "it downloads videos from the profile posted
            stories instead of the exact story that the link was copied from."
            The threshold was `> 1`, so a story containing a SINGLE snap fell
            through to `collectSnaps`, which walks the entire page blob and
            therefore swept in every highlight folder on that profile. The link
            addressed one story; the download produced someone's archive.

            The old threshold made sense when the two containers were merged
            and a lone snap really was ambiguous. Now that a live story wins
            cleanly, one snap is simply a one-snap story, and re-scanning can
            only ever ADD media the link did not ask for.
          */
          const snaps = known.length > 0 ? known : dedupeSnaps(collectSnaps(data));

          if (snaps.length) {
            // Only narrow to a single snap when the link actually addresses one.
            // A folder link means "give me the folder".
            const matched = isCollectionUrl(url) ? null : matchSnap(snaps, url);
            const chosen = matched ? [matched] : snaps;
            formats = chosen.map((s, i) => snapFormat(s, i, chosen.length));
            title = matched?.snapTitle ?? snaps[0]?.snapTitle;
          }
        }
      } catch {
        /* fall through to regex */
      }
    }

    // Generic fallback: any Snapchat CDN media URL in the page (covers layout
    // changes). Spotlight uses extension-less /d/ or /y/ paths; stories use .mp4.
    if (!mediaUrl && !formats?.length) {
      /*
        Collect EVERY media URL on the page, not the first one.

        This is the path a saved story folder used to take, and `String.match`
        without /g returns a single match — so a folder of many videos produced
        exactly one download. Now it gathers all of them (de-duplicated, order
        preserved) and only falls back to a single format when there genuinely is
        just one.
      */
      const found: string[] = [];
      const seen = new Set<string>();
      const push = (raw: string | undefined) => {
        if (!raw) return;
        const clean = unescapeJsonUrl(raw);
        // Keyed on the PATH, not the whole URL: the CDN signs these links, so
        // the same snap can appear twice with different query strings and would
        // otherwise be downloaded twice.
        const key = clean.split("?")[0] ?? clean;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(clean);
        }
      };
      for (const m of html.matchAll(
        /"contentUrl":"(https:\\?\/\\?\/[a-z0-9.-]*sc-cdn\.net\\?\/[^"]+?)"/gi,
      )) {
        push(m[1]);
      }
      for (const m of html.matchAll(
        /https:\/\/[a-z0-9.-]*sc-cdn\.net\/[^"'\\ ]+?\.(?:mp4|mov)[^"'\\ ]*/gi,
      )) {
        push(m[0]);
      }

      if (found.length > 1) {
        formats = found.map((u, i) => ({
          ...videoFormat(stripSnapWatermark(cleanUrl(u))),
          formatId: `snap-${i}`,
          label: `Story ${i + 1}`,
          isSeparateItem: true,
          // This path scrapes raw media URLs out of the HTML and has no poster
          // for any of them. Left null deliberately: the grid then falls back
          // to the post thumbnail, which is honest, rather than us inventing a
          // per-item cover that belongs to a different snap.
          thumbnail: null,
        }));
      } else if (found.length === 1) {
        mediaUrl = found[0];
      }
    }

    if (!mediaUrl && !formats?.length) {
      throw new ExtractionError(
        "No Snapchat video found (story may be expired or image-only)",
      );
    }

    const finalFormats =
      formats && formats.length
        ? formats
        : [videoFormat(stripSnapWatermark(cleanUrl(mediaUrl!)))];

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (title || metaContent(html, "og:title") || "Snapchat story").slice(0, 200),
      description: vm?.description ?? metaContent(html, "og:description"),
      /*
        The cover must be one of the snaps we actually returned.

        Owner (2026-08-04): "snapchat only shows a cover of a video that wasn't
        fetched and downloaded." The share page's og:image is Snapchat's own
        preview card — a snap chosen by them, frequently not one in the list we
        extracted — so the header advertised media the download would never
        produce.

        The first fetched item's own poster is the honest cover: it is
        guaranteed to be something the member is about to get. Spotlight keeps
        its `videoMetadata.thumbnailUrl` (a single video, where that IS the
        item), and og:image survives only as the last resort.
      */
      thumbnail:
        finalFormats.find((f) => f.thumbnail)?.thumbnail ??
        (vm?.thumbnailUrl ? cleanUrl(vm.thumbnailUrl) : metaContent(html, "og:image")),
      durationSeconds: vm?.durationMs ? Math.round(vm.durationMs / 1000) : null,
      creator: creatorName(vm?.creator),
      uploadDate: null,
      viewCount: vm?.viewCount != null ? Number(vm.viewCount) || null : null,
      likeCount: null,
      webpageUrl: url,
      formats: finalFormats,
      extractor: "snapchat",
    };
  },
};
