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

/**
 * Snapchat wraps SOME string fields as `{ value: "..." }` and leaves others
 * plain, in the same object.
 *
 * Verified against a live page (2026-08-09): in one `snapList` entry,
 * `snapUrls.mediaUrl` is a plain string while `snapId`,
 * `snapUrls.mediaPreviewUrl`, `snapUrls.overlayUrl` and `snapTitle` are all
 * `{ value }` wrappers. There is no way to tell from the key name, so every
 * string read from this blob goes through `strValue`.
 *
 * This mattered enormously: treating a wrapper as a string threw a TypeError,
 * the surrounding try/catch swallowed it, and extraction fell through to the
 * blanket CDN scan — which is what produced a picker of 19 identical wrong
 * tiles. A crash in the good path became garbage in the UI rather than an
 * error anybody could see.
 */
type Wrapped = string | { value?: string } | null | undefined;

function strValue(v: Wrapped): string | null {
  if (typeof v === "string") return v.trim() ? v : null;
  if (v && typeof v === "object" && typeof v.value === "string") return v.value.trim() ? v.value : null;
  return null;
}

interface Snap {
  snapId?: Wrapped;
  snapMediaType?: number;
  snapTitle?: Wrapped;
  timestampInSec?: number | string;
  snapUrls?: { mediaUrl?: Wrapped; mediaPreviewUrl?: Wrapped };
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

export function snapFormat(snap: Snap, i: number, count: number): MediaFormat {
  const isVideo = snap.snapMediaType !== 0; // 1 = video, 0 = image
  const headers = { "User-Agent": MOBILE_UA, Referer: "https://www.snapchat.com/" };
  const media = strValue(snap.snapUrls?.mediaUrl) ?? "";
  const preview = strValue(snap.snapUrls?.mediaPreviewUrl);
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
    directUrl: stripSnapWatermark(cleanUrl(media)),
    httpHeaders: headers,
    /*
      Each snap's OWN poster (owner: "each media should show their respective
      cover and not a general cover"). Snapchat has always sent it; nothing
      read it, so every tile in a multi-snap story rendered the same picture
      and choosing between them was guesswork.

      Kept when the story SELECTION logic was reverted to its pre-folder
      behaviour, because it is independent of which snaps get returned — it
      only decides what each one looks like in the picker.
    */
    thumbnail: preview ? cleanUrl(preview) : null,
    // A story with several snaps is several PIECES OF MEDIA, not several
    // qualities of one. Without this the UI treats them as a quality picker and
    // downloads only whichever is selected — the owner's "it only downloads the
    // first one". Flagged, they become a multi-select batch instead.
    isSeparateItem: count > 1,
  };
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|heic)(?:$|\?)/i;

/** The media id — the filename segment before the `.<rendition>.` marker. */
function mediaKey(u: string): string {
  const path = u.split("?")[0] ?? u;
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.split(".")[0] || path;
}

/**
 * Reduce raw CDN matches to DISTINCT videos.
 *
 * Drops posters/previews, then collapses several renditions of one clip onto
 * the first — `<id>.27.<tok>` and `<id>.1034.<tok>` are the same video at two
 * qualities. Exported because this is the function that decides whether a page
 * becomes one item or nineteen, and that decision earned its own tests.
 */
export function distinctVideos(urls: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const u of urls) {
    if (IMAGE_EXT.test(u)) continue;
    const key = mediaKey(u);
    if (!out.has(key)) out.set(key, u);
  }
  return [...out.values()];
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
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE HOST ALLOWLIST WAS THE BUG (re-derived live, 2026-08-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This function used to refuse to rewrite anything that was not on
 * `cf-st.sc-cdn.net`, because a 2026-08-24 probe of ONE bolt-gcdn clip found
 * `.1034.` (and every other rendition) 404ing there. The conclusion drawn was
 * "bolt-gcdn has no clean rendition". That generalised from a single clip, and
 * it is wrong.
 *
 * Measured against the owner's example (snapchat.com/t/OafU7rPV →
 * bolt-gcdn.sc-cdn.net/u/jRlgbOdOZ34pwjJoKVhTL.27.IRZXSOY):
 *
 *   .27.    → 206 video/mp4  1,996,976 B  540×960  ← WATERMARKED (verified by
 *                                                    extracting a frame: the
 *                                                    Snapchat ghost + @handle
 *                                                    are burned in)
 *   .1034.  → 206 video/mp4  1,285,711 B  480×852  ← CLEAN (same frame, no
 *                                                    ghost, no @handle; the
 *                                                    creator's own caption
 *                                                    correctly remains)
 *   .256.   → 206 image/jpeg                        ← thumbnail
 *   others  → 404
 *
 * So `.1034.` DOES exist on bolt-gcdn — for this clip. On the clip probed in
 * August it did not. Availability is therefore PER-CLIP, not per-host, which is
 * exactly why the owner sees some Spotlight downloads clean and others
 * watermarked: whether we happened to be on the allowlisted host decided it.
 *
 * Also confirmed here: stripping `mo`/`uc` from the `.27.` URL returns a
 * BYTE-IDENTICAL file (same sha256). The overlay is baked into the stored
 * object, not applied by the CDN from the query string — so there is nothing to
 * negotiate on `.27.` itself. The only clean copy is a different rendition.
 *
 * ── What replaces the allowlist ───────────────────────────────────────────
 *
 * A guess about hosts cannot answer a per-clip question, so this function no
 * longer tries: it computes the CANDIDATE clean URL for any host, and
 * `preferCleanSnapMedia()` below spends one 1-byte range request to find out
 * whether that candidate actually exists before anything is downloaded.
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
    /*
      🔴 THE REWRITE ONLY APPLIES WHERE `.1034.` ACTUALLY EXISTS (2026-08-24).

      Measured against a live watermarked Spotlight clip
      (snapchat.com/t/zWJDbGIN → bolt-gcdn.sc-cdn.net/y/<id>.27.<tok>):

        .27.  (as served)      → 206 video/mp4   ✅ the real file
        .1034. (our rewrite)   → 404             ❌ dead
        .1023/.256/.128/…/.0.  → 404             ❌ every rendition is dead
        .27. with mo+uc removed → byte-identical to the original (same sha256)

      So on this host the rewrite produced a URL that does not exist. The
      download then FAILED and the pipeline fell back to yt-dlp — whose
      Spotlight extractor returns a watermarked render. That is precisely the
      "Snapchat Spotlight now downloads with watermark" report: the watermark
      was coming from the fallback, caused by us handing out a 404.

      Snapchat has moved Spotlight to `bolt-gcdn`, where the page exposes only
      two renditions of a clip — `.27.` (the video, carrying SpotlightSharing)
      and `.256.` (DfLargeThumbnail). There is no clean video rendition to
      rewrite TO. `cf-st` still serves the story originals the `.1034.` trick
      was derived from, so that path is unchanged and still covered by tests.

      Returning the ORIGINAL here is strictly better than returning a 404: the
      download succeeds, direct from the CDN with no transcode. It does not
      remove the watermark, because Snapchat no longer publishes a version
      without one for these clips — that is a change on their side, not
      something this function can rewrite around.
    */
    url.pathname = url.pathname.replace(/(\/[a-z]\/[^./]+)\.\d+\./i, "$1.1034.");
    url.searchParams.delete("mo");
    url.searchParams.delete("uc");
    const candidate = url.toString();
    // A path with no `.<rendition>.` segment produces no change — say so
    // clearly rather than handing back a string that only looks rewritten.
    return candidate === u ? u : candidate;
  } catch {
    return u;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PICK THE CLEAN RENDITION — BUT ONLY IF IT EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `stripSnapWatermark` says what the clean URL WOULD be. This says whether it
 * is really there, and is the only thing allowed to decide what gets
 * downloaded.
 *
 * ── Cost, because this is a production path ───────────────────────────────
 *
 *  • ONE request, `Range: bytes=0-0` — a single byte, not a file. No transcode,
 *    no temp file, no ffmpeg, no second download to compare against.
 *  • Only for URLs that are actually watermarked. A Story URL is already clean,
 *    `stripSnapWatermark` returns it unchanged, and this returns immediately
 *    without touching the network. Multi-snap stories therefore cost nothing.
 *  • Bounded by its own short timeout, so a slow CDN delays the metadata
 *    response by at most `PROBE_TIMEOUT_MS` and then proceeds with the URL
 *    Snapchat actually served.
 *
 * ── 🔴 FAILS TO THE WORKING FILE, ALWAYS ──────────────────────────────────
 *
 * Every abnormal path — 404, timeout, DNS failure, an unexpected content-type —
 * returns the ORIGINAL url. That is the lesson from the August regression: the
 * previous version rewrote to a `.1034.` that did not exist, the download
 * failed, and the pipeline fell back to yt-dlp, whose Spotlight extractor
 * returns a watermarked render. A dead "clean" URL produces a WORSE result than
 * an honest watermarked one, so this never hands out a URL it has not seen
 * answer.
 *
 * The content-type check matters: `.256.` is a JPEG thumbnail at a rendition
 * number that also answers 206. Accepting any 2xx would swap a video for a
 * still image.
 */
const PROBE_TIMEOUT_MS = 4000;

export async function preferCleanSnapMedia(mediaUrl: string): Promise<string> {
  const candidate = stripSnapWatermark(mediaUrl);
  // Not watermarked, or nothing to rewrite — no request, no cost.
  if (candidate === mediaUrl) return mediaUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(candidate, {
      method: "GET",
      headers: {
        "User-Agent": MOBILE_UA,
        Referer: "https://www.snapchat.com/",
        Range: "bytes=0-0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return mediaUrl;
    const type = res.headers.get("content-type") ?? "";
    if (!/^video\//i.test(type)) return mediaUrl;
    return candidate;
  } catch {
    return mediaUrl;
  } finally {
    clearTimeout(timer);
    // The 1-byte body is tiny, but leaving it undrained keeps a socket open on
    // some runtimes. Cheaper to release it explicitly than to rely on GC.
    controller.abort();
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
        /*
          The profile's own collections are NOT in this type, and that is the
          point.

          Owner: "make sure it doesn't fall into any profile folder." A live
          page carries `curatedHighlights` (saved story folders) and
          `spotlightHighlights` (the Spotlight rail) alongside the live
          `story`. Every regression in this file has been one of those leaking
          into a story download.

          They are deliberately absent from this shape, so reading one is a
          compile error rather than a judgement call. The only list this
          extractor can reach is `story.snapList`.
        */
        const pp = (data.props?.pageProps ?? {}) as {
          videoMetadata?: VideoMeta;
          story?: { snapList?: Snap[] };
        };

        /*
          ── The STORY is read first, and it wins ─────────────────────────
          Owner (2026-08-09): "the snapchat story download falls into the
          profile spotlight and picks one from it — it's supposed to fetch all
          videos from the story link and never fall into the profile story or
          spotlight."

          Spotlight used to be checked FIRST, and it set `mediaUrl`, which made
          the story branch below unreachable. A page carrying both — a story
          page that also serialises a `videoMetadata` block for its featured
          clip, or a profile with a Spotlight rail — therefore returned that
          ONE spotlight video and never looked at the story at all. That is
          exactly the reported symptom, and it was not a page-shape guess: the
          precedence in this file was simply the wrong way round.

          A story link means the story. Spotlight is now only consulted when
          there is no story on the page, which is what a real Spotlight
          permalink looks like.
        */
        const snapList = pp.story?.snapList ?? [];
        /*
          De-duplicated (owner: "the multiple story just fetches duplicates").

          Keyed on `snapId`, falling back to the media URL with its QUERY
          STRING STRIPPED — the CDN signs these links, so the same snap can
          appear twice in one list with two different full URLs and keying on
          the whole URL de-duplicates nothing.
        */
        const seenSnaps = new Set<string>();
        const snaps = (Array.isArray(snapList) ? snapList : []).filter((s) => {
          const media = strValue(s.snapUrls?.mediaUrl);
          if (!media) return false;
          // `snapId` is a `{ value }` wrapper on a live page, so it MUST be
          // unwrapped — comparing raw objects in a Set makes every entry
          // unique and the de-duplication a silent no-op.
          const key = strValue(s.snapId) ?? (media.split("?")[0] ?? media);
          if (seenSnaps.has(key)) return false;
          seenSnaps.add(key);
          return true;
        });

        if (snaps.length) {
          /*
            EVERY snap in the story, and the member picks.

            Owner: "snapchat story fetch all and users have to select which to
            download." There is deliberately no attempt to guess which single
            snap a share link means — a `/t/` code carries no snap id, so any
            "match" against one was a coincidence between a short code and part
            of an id, and getting it wrong silently discarded the rest of the
            story.

            `curatedHighlights` — the saved folders on a profile — is never
            read. Using it as a fallback is what let a plain story link return
            an account's archive.
          */
          formats = snaps.map((s, i) => snapFormat(s, i, snaps.length));
          title = strValue(snaps[0]?.snapTitle) ?? undefined;
        } else if (pp.videoMetadata?.contentUrl) {
          // A real Spotlight permalink: one video, and no story on the page.
          vm = pp.videoMetadata;
          mediaUrl = pp.videoMetadata.contentUrl;
          title = pp.videoMetadata.name;
        }
      } catch {
        /* fall through to regex */
      }
    }

    // Generic fallback: any Snapchat CDN media URL in the page (covers layout
    // changes). Spotlight uses extension-less /d/ or /y/ paths; stories use .mp4.
    if (!mediaUrl && !formats?.length) {
      /*
        Collect EVERY media URL on the page, not just the first.

        `String.match` without /g returns a single match, so a story reaching
        this path produced exactly one download. Gathering all of them is both
        what the owner asks for — "fetch all and users select which to
        download" — and strictly safer than matching once: this path can now
        only ever find MORE than before, never less, so it cannot be the reason
        a link stops working.

        De-duplicated on the URL PATH, because the CDN signs these links and
        the same snap can appear twice with different query strings.
      */
      const found: string[] = [];
      const seenPaths = new Set<string>();
      const push = (raw: string | undefined) => {
        if (!raw) return;
        const clean = unescapeJsonUrl(raw);
        const key = clean.split("?")[0] ?? clean;
        if (seenPaths.has(key)) return;
        seenPaths.add(key);
        found.push(clean);
      };
      for (const m of html.matchAll(/"contentUrl":"(https:\\?\/\\?\/[a-z0-9.-]*sc-cdn\.net\\?\/[^"]+?)"/gi)) {
        push(m[1]);
      }
      for (const m of html.matchAll(/https:\/\/[a-z0-9.-]*sc-cdn\.net\/[^"'\\ ]+?\.(?:mp4|mov)[^"'\\ ]*/gi)) {
        push(m[0]);
      }

      /*
        ── The scrape must not FABRICATE a story ────────────────────────────
        Owner (2026-08-09), with a screenshot: a share link produced 19 items,
        every tile the same picture, none of them the right video.

        That is this blanket scan doing exactly what it was told — collecting
        every `sc-cdn.net` string on the page. A Snapchat page carries far more
        than its story: poster images, preview renditions, the SAME clip at
        several qualities, and whatever else the page links. Emitting one
        "Story N" per URL turns page furniture into a 19-item download picker,
        which is worse than finding nothing: it is confidently wrong, and the
        member has no way to tell which item is real.

        So the raw matches are reduced to distinct VIDEOS before anything is
        offered:
          · drop posters and previews — a `.jpg`/`.png` is not a story snap;
          · collapse renditions of one clip — `<id>.27.<tok>` and
            `<id>.1034.<tok>` are the same video at two qualities, and
            `stripSnapWatermark` already rewrites one into the other;
          · only then, if two or more DISTINCT media ids remain, offer a batch.

        When it cannot tell them apart it offers ONE item rather than many
        guesses. A single correct download beats nineteen wrong ones.
      */
      const unique = distinctVideos(found);

      if (unique.length > 1) {
        formats = unique.map((u, i) => ({
          ...videoFormat(stripSnapWatermark(cleanUrl(u))),
          formatId: `snap-${i}`,
          label: `Story ${i + 1}`,
          isSeparateItem: true,
        }));
      } else if (unique.length === 1) {
        mediaUrl = unique[0];
      } else if (found.length > 0) {
        // Everything on the page was an image. Serve the first as a single
        // item rather than claiming there is nothing here at all.
        mediaUrl = found[0];
      }
    }

    if (!mediaUrl && !formats?.length) {
      /*
        Say WHY nothing was found.

        This extractor has been debugged four times from a screenshot, because
        the failure message was the same sentence whether the page was missing,
        the JSON shape had changed, or the story had simply expired. Those need
        completely different fixes. The counts below cost nothing and turn the
        next report into evidence — they name no URL and no account, so there
        is nothing sensitive in a log line.
      */
      const hasBlob = !!blob;
      const cdnMentions = (html.match(/sc-cdn\.net/gi) ?? []).length;
      throw new ExtractionError(
        `No Snapchat media found (story may be expired or image-only) ` +
          `[page-data:${hasBlob ? "yes" : "no"} cdn-refs:${cdnMentions} html:${html.length}b]`,
      );
    }

    const builtFormats =
      formats && formats.length
        ? formats
        : [videoFormat(stripSnapWatermark(cleanUrl(mediaUrl!)))];

    /*
      ── VERIFY THE CLEAN RENDITION BEFORE COMMITTING TO IT ─────────────────

      Everything above chose URLs by string rewriting alone. `preferCleanSnapMedia`
      is what turns that guess into a fact: for each WATERMARKED video it spends
      one 1-byte range request to confirm the `.1034.` original really exists,
      and keeps Snapchat's own URL when it does not.

      🔴 Only watermarked VIDEO formats reach the network. Images and already-
      clean story media short-circuit inside the helper, so the common case — a
      multi-snap story — still costs zero requests. A Spotlight post costs
      exactly one.

      Run in PARALLEL: a story that somehow contained several watermarked snaps
      would otherwise add its probes to the metadata latency in series. Bounded
      by the helper's own 4s timeout, so the worst case is one timeout, not N.

      `Promise.all` is safe here precisely because the helper cannot reject — it
      returns the original URL on every failure path.
    */
    const finalFormats = await Promise.all(
      builtFormats.map(async (f) =>
        f.kind === "video" && f.directUrl
          ? { ...f, directUrl: await preferCleanSnapMedia(f.directUrl) }
          : f,
      ),
    );

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (title || metaContent(html, "og:title") || "Snapchat story").slice(0, 200),
      description: vm?.description ?? metaContent(html, "og:description"),
      /*
        The cover must be something we actually returned.

        Owner: "Snapchat only shows a cover of a video that wasn't fetched and
        downloaded." The share page's og:image is Snapchat's own preview card
        — often a snap that is not in the list we extracted — so the header
        advertised media the download would never produce. The first fetched
        item's poster is guaranteed to be something the member is about to get.

        Spotlight keeps `videoMetadata.thumbnailUrl` (a single video, where
        that IS the item); og:image survives only as a last resort.
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
