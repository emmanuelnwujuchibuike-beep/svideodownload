import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { metaImageCandidates, metaVideoCandidates } from "./media-quality";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Threads custom extractor. Threads runs on Meta's infrastructure (like
 * Instagram), so a public post embeds the direct MP4 in the page's inline JSON
 * (`video_url` / `video_versions`) or an `og:video` meta tag. We read those for
 * a fast download and fall back to yt-dlp otherwise.
 */

const TIMEOUT_MS = Number(process.env.THREADS_EXTRACTOR_TIMEOUT_MS || 9000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * The best video rendition on the page.
 *
 * 🔴 `video_versions` IS RANKED, AND IT COMES FIRST (audited 2026-08-31).
 *
 * This used to read it with `"video_versions":\[\{"[^}]*?"url":"([^"]+)"` —
 * the same unmatchable pattern the photo path had (see `media-quality.ts`), so
 * it never fired — and it sat BELOW `"video_url"` in the fallback chain, which
 * `firstMatch` resolves in order. Even had it matched, it would have taken the
 * FIRST rendition rather than the largest.
 *
 * `video_versions` is the only source here that describes SEVERAL renditions
 * with their dimensions, so it is the only one that can be ranked — which is
 * exactly why it should be asked first. The single-URL sources below it stay as
 * fallbacks, ending with `og:video`, which is a share preview.
 */
function findVideoUrl(html: string): string | null {
  const ranked = metaVideoCandidates(html);
  if (ranked.length > 0) return unescapeJsonUrl(ranked[0]!.url);
  const raw = firstMatch(
    html,
    /"video_url":"([^"]+)"/,
    /property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
  );
  return raw ? unescapeJsonUrl(raw) : null;
}

export const threadsExtractor: Extractor = {
  name: "threads",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "threads";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        url,
        { headers: HEADERS, redirect: "follow", signal: controller.signal },
        "threads",
      );
      if (!res.ok) throw new ExtractionError(`Threads responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.threads.com/" };
    const videoUrl = findVideoUrl(html);
    const formats: MediaFormat[] = [];

    if (videoUrl && videoUrl.startsWith("http")) {
      formats.push({
        formatId: "best",
        kind: "video",
        label: "HD",
        ext: "mp4",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: videoUrl,
        httpHeaders: headers,
      });
    } else {
      /*
        Photo / carousel post → one entry per picture, at its LARGEST rendition.

        🔴 THE OLD PATTERN COULD NOT MATCH WHAT META EMITS (audited 2026-08-31).

        It was `"image_versions2":\{"candidates":\[\{"[^}]*?"url":"([^"]+)"`.
        The `\[\{"` consumes the opening quote of the first key, so the pattern
        then needs ANOTHER `"url":"` before the first `}` — and `[^}]` cannot
        cross that brace. Meta writes `url` as the FIRST key of a candidate, so
        the match died every time and every photo fell through to the
        `display_url` loop below: the resized DISPLAY copy, not the original.

        It also treated `display_url` as an ADDITIONAL photo. Since that is the
        same picture as a candidate at a different size, a single-photo post
        could be reported as two photos, and "Photo 1" was whichever rendition
        the regexes happened to reach first.

        `metaImageCandidates` locates each block and reads its candidates as
        objects, so key order is irrelevant, and returns the widest per block —
        one entry per picture, in page order.
      */
      const imgs: string[] = [];
      for (const { url } of metaImageCandidates(html)) {
        const u = unescapeJsonUrl(url);
        if (u.startsWith("http") && !imgs.includes(u)) imgs.push(u);
      }
      /*
        `display_url` is now a FALLBACK, not an addition. A post whose payload
        carries no candidates array at all (Meta varies this by surface) still
        has to yield its photos, and this is the only other place they appear.
      */
      if (imgs.length === 0) {
        for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) {
          const u = unescapeJsonUrl(m[1]!);
          if (u.startsWith("http") && !imgs.includes(u)) imgs.push(u);
        }
      }
      // Last resort: the share preview. Smaller than either of the above, and
      // only ever better than returning nothing at all.
      if (imgs.length === 0) {
        const og = metaContent(html, "og:image");
        if (og) imgs.push(og);
      }
      imgs.forEach((img, i) => {
        formats.push({
          formatId: `img-${i}`,
          kind: "image",
          label: imgs.length > 1 ? `Photo ${i + 1}` : "Photo",
          ext: /\.png/i.test(img) ? "png" : /\.webp/i.test(img) ? "webp" : "jpg",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          vcodec: null,
          acodec: null,
          directUrl: img,
          httpHeaders: headers,
        });
      });
    }

    if (formats.length === 0) {
      throw new ExtractionError("No Threads media (private or login-walled)");
    }

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (metaContent(html, "og:title") || "Threads video").slice(0, 200),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator: firstMatch(html, /"username":"([^"]+)"/),
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "threads",
    };
  },
};
