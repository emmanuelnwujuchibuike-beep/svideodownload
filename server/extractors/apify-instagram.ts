import type { MediaFormat, VideoMetadata } from "@/types";

import { detectPlatform } from "@/lib/platforms";

/**
 * Apify fallback for Instagram & Threads — the reliable way to get image posts,
 * carousels and (when sessions die) reels server-side.
 *
 * Configure on the worker:
 *   APIFY_TOKEN          = <your token>
 *   APIFY_IG_ACTOR       = apify/instagram-scraper            (default)
 *   APIFY_THREADS_ACTOR  = futurizerush/meta-threads-scraper  (optional, for Threads)
 *
 * Dormant (returns null) when APIFY_TOKEN isn't set.
 */

const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim().replace(/^["']|["']$/g, "");
const APIFY_IG_ACTOR = (process.env.APIFY_IG_ACTOR || "apify/instagram-scraper").trim();
const APIFY_THREADS_ACTOR = process.env.APIFY_THREADS_ACTOR?.trim();
const TIMEOUT_MS = Number(process.env.APIFY_TIMEOUT_MS || 90_000);

const IMG_HEADERS = { "User-Agent": "Mozilla/5.0", Referer: "https://www.instagram.com/" };

export function apifyEnabled(): boolean {
  return !!APIFY_TOKEN;
}
export function isApifyPlatform(platform: string): boolean {
  if (platform === "instagram") return true;
  if (platform === "threads") return !!APIFY_THREADS_ACTOR;
  return false;
}

async function runActor(actor: string, input: unknown): Promise<unknown[] | null> {
  const path = actor.replace("/", "~");
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${path}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const items = await res.json();
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

function videoFormat(id: string, label: string, url: string): MediaFormat {
  return {
    formatId: id, kind: "video", label, ext: "mp4",
    resolution: null, fps: null, filesize: null, tbr: null,
    vcodec: "h264", acodec: "aac", directUrl: url, httpHeaders: IMG_HEADERS,
  };
}
function imageFormat(id: string, label: string, url: string): MediaFormat {
  return {
    formatId: id, kind: "image", label,
    ext: /\.png/i.test(url) ? "png" : /\.webp/i.test(url) ? "webp" : "jpg",
    resolution: null, fps: null, filesize: null, tbr: null,
    vcodec: null, acodec: null, directUrl: url, httpHeaders: IMG_HEADERS,
  };
}

/* ----------------------------- Instagram ----------------------------- */

interface IgMedia {
  videoUrl?: string;
  displayUrl?: string;
  images?: string[];
  childPosts?: IgMedia[];
}
interface IgItem extends IgMedia {
  caption?: string;
  ownerUsername?: string;
  shortCode?: string;
  videoDuration?: number;
  error?: string;
}

function igFormats(item: IgItem): { formats: MediaFormat[]; thumb: string | null } {
  const children = item.childPosts?.length ? item.childPosts : [item];
  const formats: MediaFormat[] = [];
  let thumb: string | null = item.displayUrl ?? null;
  children.forEach((c, i) => {
    if (c.videoUrl?.startsWith("http")) {
      formats.push(videoFormat(children.length > 1 ? `vid-${i}` : "best", children.length > 1 ? `Video ${i + 1}` : "HD", c.videoUrl));
      if (!thumb) thumb = c.displayUrl ?? null;
    } else {
      const img = c.displayUrl || c.images?.[0];
      if (img?.startsWith("http")) formats.push(imageFormat(`img-${i}`, children.length > 1 ? `Photo ${i + 1}` : "Photo", img));
    }
  });
  return { formats, thumb };
}

/* ------------------------------ Threads ------------------------------ */

interface ThreadsItem {
  post_url?: string;
  media_url?: string;
  media_urls?: string[];
  media_type?: string;
  has_media?: boolean;
  has_audio?: boolean;
  text_content?: string;
  username?: string;
}

function threadsFormats(post: ThreadsItem): MediaFormat[] {
  const urls = (post.media_urls?.length ? post.media_urls : post.media_url ? [post.media_url] : []).filter(
    (u) => typeof u === "string" && u.startsWith("http"),
  );
  const isVideo = /video/i.test(post.media_type || "") || !!post.has_audio;
  const formats: MediaFormat[] = [];
  if (isVideo) {
    const v = urls.find((u) => /\.mp4|video/i.test(u)) || urls[0];
    if (v) formats.push(videoFormat("best", "HD", v));
    // any remaining images in the post
    urls.filter((u) => u !== v && /\.(jpg|jpeg|png|webp)/i.test(u)).forEach((u, i) =>
      formats.push(imageFormat(`img-${i}`, `Photo ${i + 1}`, u)),
    );
  } else {
    urls.forEach((u, i) => formats.push(imageFormat(`img-${i}`, urls.length > 1 ? `Photo ${i + 1}` : "Photo", u)));
  }
  return formats;
}

/* ------------------------------- entry ------------------------------- */

export async function apifyExtract(url: string): Promise<VideoMetadata | null> {
  if (!APIFY_TOKEN) return null;
  const platform = detectPlatform(url);

  if (platform.id === "threads") {
    if (!APIFY_THREADS_ACTOR) return null;
    const m = url.match(/threads\.(?:net|com)\/@([^/?]+)\/post\/([A-Za-z0-9_-]+)/i);
    const username = m?.[1];
    const code = m?.[2];
    if (!username || !code) return null;
    const items = (await runActor(APIFY_THREADS_ACTOR, {
      mode: "user",
      usernames: [username],
      max_posts: 10, // actor minimum — fewer posts = faster fetch
    })) as ThreadsItem[] | null;
    if (!items) return null;
    const post =
      items.find((p) => (p.post_url || "").includes(`/post/${code}`)) ??
      items.find((p) => (p.post_url || "").includes(code));
    if (!post || post.has_media === false) return null;
    const formats = threadsFormats(post);
    if (formats.length === 0) return null;
    return {
      id: code!,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: post.text_content?.trim().slice(0, 200) || "Threads post",
      description: post.text_content?.trim() || null,
      thumbnail: formats.find((f) => f.kind === "image")?.directUrl ?? null,
      durationSeconds: null,
      creator: post.username || username || null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "ytdlp",
    };
  }

  // Instagram
  const items = (await runActor(APIFY_IG_ACTOR, {
    directUrls: [url],
    resultsType: "posts",
    resultsLimit: 1,
    addParentData: false,
  })) as IgItem[] | null;
  const item = items?.find((it) => !it.error && (it.videoUrl || it.displayUrl || it.childPosts));
  if (!item) return null;
  const { formats, thumb } = igFormats(item);
  if (formats.length === 0) return null;
  return {
    id: item.shortCode || crypto.randomUUID(),
    platform: platform.id,
    platformName: platform.name,
    sourceUrl: url,
    title: item.caption?.trim().slice(0, 200) || "Instagram post",
    description: item.caption?.trim() || null,
    thumbnail: thumb,
    durationSeconds: item.videoDuration ?? null,
    creator: item.ownerUsername ?? null,
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: url,
    formats,
    extractor: "ytdlp",
  };
}
