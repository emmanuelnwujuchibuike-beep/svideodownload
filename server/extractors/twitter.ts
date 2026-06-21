import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { ExtractionError, type Extractor } from "./types";

/**
 * X / Twitter custom extractor via the public syndication API
 * (cdn.syndication.twimg.com) — the same endpoint embed widgets use. It returns
 * tweet JSON including direct MP4 video variants (no auth, not WAF-blocked), so
 * we can pick the highest bitrate and proxy it directly.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TWITTER_TIMEOUT_MS = Number(process.env.TWITTER_EXTRACTOR_TIMEOUT_MS || 8000);

interface TwVariant {
  bitrate?: number;
  content_type?: string;
  url?: string;
}
interface TwMedia {
  type?: string;
  video_info?: { variants?: TwVariant[]; duration_millis?: number };
  media_url_https?: string;
}
interface TwResult {
  __typename?: string;
  text?: string;
  user?: { name?: string; screen_name?: string };
  mediaDetails?: TwMedia[];
  // Reposts / quote tweets nest the original tweet (with its video) here.
  quoted_tweet?: TwResult;
  retweeted_status_result?: { result?: TwResult };
}

/** Collects media from a tweet AND any tweet it reposts/quotes. */
function collectMedia(t: TwResult | undefined, depth = 0): TwMedia[] {
  if (!t || depth > 3) return [];
  return [
    ...(t.mediaDetails ?? []),
    ...collectMedia(t.quoted_tweet, depth + 1),
    ...collectMedia(t.retweeted_status_result?.result, depth + 1),
  ];
}

/** Extracts the numeric tweet id from any x.com / twitter.com status URL. */
function parseTweetId(url: string): string | null {
  const m = url.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1]! : null;
}

/** Token the syndication endpoint expects, derived from the tweet id. */
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

function buildFormats(media: TwMedia[]): MediaFormat[] {
  const video = media.find((m) => m.type === "video" || m.video_info);
  const variants = (video?.video_info?.variants ?? [])
    .filter((v) => v.content_type === "video/mp4" && v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://twitter.com/" };
  const formats: MediaFormat[] = [];
  const seen = new Set<number>();

  for (const v of variants) {
    // Derive a height label from the URL when present (…/720x1280/…).
    const dims = v.url!.match(/\/(\d+)x(\d+)\//);
    const height = dims ? Number(dims[2]) : null;
    const key = height ?? Math.round((v.bitrate ?? 0) / 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    formats.push({
      formatId: height ? String(height) : `tw-${formats.length}`,
      kind: "video",
      label: height ? `${height}p` : `${Math.round((v.bitrate ?? 0) / 1000)}k`,
      ext: "mp4",
      resolution: height ? `${height}p` : null,
      fps: null,
      filesize: null,
      tbr: v.bitrate ? Math.round(v.bitrate / 1000) : null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: v.url,
      httpHeaders: headers,
    });
  }

  return formats;
}

export const twitterExtractor: Extractor = {
  name: "twitter",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "twitter";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    const id = parseTweetId(url);
    if (!id) throw new ExtractionError("Unrecognised tweet URL");

    // Match the params Twitter's own embed widget sends — some tweets now
    // return an empty body without the `features`/`fieldToggles` toggles.
    const features =
      "tfw_timeline_list:;tfw_follower_count_sunset:true;" +
      "tfw_tweet_edit_backend:on;tfw_refsrc_session:on;" +
      "tfw_show_business_verified_badge:on;tfw_duplicate_scribes_to_settings:on;" +
      "tfw_use_profile_image_shape_enabled:on;tfw_show_blue_verified_badge:on;" +
      "tfw_legacy_timeline_sunset:on;tfw_show_gov_verified_badge:on;" +
      "tfw_show_business_affiliate_badge:on;tfw_tweet_edit_frontend:on";
    const api =
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}` +
      `&token=${syndicationToken(id)}&lang=en` +
      `&features=${encodeURIComponent(features)}` +
      `&fieldToggles=${encodeURIComponent("withArticleRichContentState:true")}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TWITTER_TIMEOUT_MS);
    let data: TwResult;
    try {
      const res = await extractorFetch(
        api,
        {
          headers: { "User-Agent": DESKTOP_UA, Referer: "https://platform.twitter.com/" },
          signal: controller.signal,
        },
        "twitter",
      );
      if (!res.ok) throw new ExtractionError(`Syndication responded ${res.status}`);
      const body = await res.text();
      if (!body.trim()) throw new ExtractionError("Empty syndication response");
      try {
        data = JSON.parse(body) as TwResult;
      } catch {
        throw new ExtractionError("Unparseable syndication response");
      }
    } finally {
      clearTimeout(timer);
    }

    if (data.__typename === "TweetTombstone") {
      throw new ExtractionError("Tweet unavailable");
    }

    // Include media from the tweet AND any tweet it reposts/quotes.
    const media = collectMedia(data);
    if (media.length === 0) throw new ExtractionError("Tweet has no video");

    const formats = buildFormats(media);
    if (formats.length === 0) throw new ExtractionError("No video in tweet");

    const durationMs = media.find((m) => m.video_info)?.video_info
      ?.duration_millis;

    return {
      id,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: data.text?.trim() || "X video",
      description: data.text?.trim() || null,
      thumbnail: media.find((m) => m.media_url_https)?.media_url_https ?? null,
      durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
      creator: data.user?.name || data.user?.screen_name || null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "twitter",
    };
  },
};
