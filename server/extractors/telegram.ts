import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Telegram custom extractor — PUBLIC channel posts.
 *
 * Telegram exposes every public post through its own embed widget
 * (`t.me/<channel>/<id>?embed=1`), a small HTML page that carries the direct
 * media URLs on the public `cdn-telegram.org` CDN. We read those the same way the
 * other page-scraping extractors do — no API key, no bot, no scraping of anything
 * that isn't already publicly served — and support the media types the embed
 * exposes: videos (incl. round video notes), photos, whole albums/media groups,
 * and voice/audio.
 *
 * Scope is honest: only PUBLIC content is reachable this way. Private channels,
 * saved messages and Stories are gated behind Telegram's authenticated MTProto
 * API (an api_id/api_hash + a user session) — without those credentials the embed
 * returns no media and we surface a clear "not publicly available" error rather
 * than pretend. On any failure the registry still falls through to yt-dlp.
 */

const TIMEOUT_MS = Number(process.env.TELEGRAM_EXTRACTOR_TIMEOUT_MS || 9000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MEDIA_HEADERS = { "User-Agent": DESKTOP_UA, Referer: "https://t.me/" };

/** `t.me/<channel>/<id>` (or the `/s/` view) → the embed URL that carries media. */
function embedUrl(raw: string): { embed: string; channel: string; postId: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  // Normalize the path: strip a leading `/s/` (web-view) segment.
  const parts = u.pathname.replace(/^\/s\//, "/").split("/").filter(Boolean);
  // Expect [channel, postId]; a bare channel has no single downloadable post.
  if (parts.length < 2) return null;
  const channel = parts[0]!;
  const postId = parts[1]!;
  if (!/^\d+$/.test(postId)) return null;
  return { embed: `https://t.me/${channel}/${postId}?embed=1&mode=tme`, channel, postId };
}

function base(id: string, kind: MediaFormat["kind"], label: string, ext: string, directUrl: string): MediaFormat {
  return {
    formatId: id,
    kind,
    label,
    ext,
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: kind === "video" ? "h264" : null,
    acodec: kind === "video" || kind === "audio" ? "aac" : null,
    directUrl,
    httpHeaders: MEDIA_HEADERS,
  };
}

/** Every media URL the embed exposes — videos, then photos (albums), then voice. */
function collectFormats(html: string): MediaFormat[] {
  const formats: MediaFormat[] = [];
  const seen = new Set<string>();

  const add = (u: string, make: (url: string) => MediaFormat) => {
    const url = unescapeJsonUrl(u);
    if (!url.startsWith("http") || seen.has(url)) return;
    seen.add(url);
    formats.push(make(url));
  };

  // Videos (regular + round video notes) — `<video ... src="…">`.
  let m: RegExpExecArray | null;
  const videoRe = /<video[^>]+src="([^"]+)"/gi;
  let vi = 0;
  while ((m = videoRe.exec(html))) {
    const idx = vi;
    add(m[1]!, (url) => base(`tg-v-${idx}`, "video", vi > 1 ? `Video ${vi}` : "Video", "mp4", url));
    vi = formats.filter((f) => f.kind === "video").length;
  }

  // Photos / albums — `class="tgme_widget_message_photo_wrap …" style="background-image:url('…')"`.
  const photoRe = /tgme_widget_message_photo_wrap[^>]*background-image:\s*url\((?:&#39;|['"]?)([^'")]+?)(?:&#39;|['"]?)\)/gi;
  let pi = 0;
  while ((m = photoRe.exec(html))) {
    const idx = pi;
    add(m[1]!, (url) =>
      base(`tg-img-${idx}`, "image", pi > 0 ? `Photo ${pi + 1}` : "Photo", /\.png/i.test(url) ? "png" : "jpg", url),
    );
    pi = formats.filter((f) => f.kind === "image").length;
  }

  // Voice / audio — `<audio ... src="…">`.
  const audio = html.match(/<audio[^>]+src="([^"]+)"/i);
  if (audio?.[1]) {
    add(audio[1], (url) =>
      base("tg-audio", "audio", "Audio", /\.mp3/i.test(url) ? "mp3" : /\.og[ga]/i.test(url) ? "ogg" : "m4a", url),
    );
  }

  return formats;
}

export const telegramExtractor: Extractor = {
  name: "telegram",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "telegram";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    const parsed = embedUrl(url);
    if (!parsed) {
      throw new ExtractionError("Not a downloadable Telegram post — link to a specific public post (t.me/<channel>/<id>).");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        parsed.embed,
        { headers: HEADERS, redirect: "follow", signal: controller.signal },
        "telegram",
      );
      if (!res.ok) throw new ExtractionError(`Telegram responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    let formats = collectFormats(html);

    // Photo-only post whose image didn't match the wrapper regex → fall back to
    // the Open Graph image so a public photo still downloads.
    if (formats.length === 0) {
      const ogImage = metaContent(html, "og:image");
      if (ogImage && ogImage.startsWith("http")) {
        formats = [base("tg-img-0", "image", "Photo", /\.png/i.test(ogImage) ? "png" : "jpg", ogImage)];
      }
    }

    if (formats.length === 0) {
      throw new ExtractionError("No public Telegram media found (the post may be private, deleted, or Stories-only).");
    }

    const ogTitle = metaContent(html, "og:title");
    const ogDesc = metaContent(html, "og:description");
    const thumbnail = metaContent(html, "og:image");

    return {
      id: `${parsed.channel}-${parsed.postId}`,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (ogDesc?.trim() || ogTitle?.trim() || `Telegram · ${parsed.channel}`).slice(0, 200),
      description: ogDesc?.trim() || null,
      thumbnail: thumbnail && thumbnail.startsWith("http") ? thumbnail : null,
      durationSeconds: null,
      creator: ogTitle?.trim() || parsed.channel,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: `https://t.me/${parsed.channel}/${parsed.postId}`,
      formats,
      extractor: "telegram",
    };
  },
};
