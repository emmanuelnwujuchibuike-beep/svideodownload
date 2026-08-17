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
 *   APIFY_IG_STORY_ACTOR = <a dedicated Story-scraper actor>  (optional, for IG Stories)
 *
 * Dormant (returns null) when APIFY_TOKEN isn't set.
 *
 * ── Why Stories need a SEPARATE actor (owner, 2026-08-17) ───────────────────
 * `APIFY_IG_ACTOR` (apify/instagram-scraper) has no Story support at all —
 * confirmed against its own published input schema, which only offers
 * Posts/Reels/Comments/Mentions/Details. This isn't a workaround for our own
 * session being rejected by Instagram's private API for Stories (confirmed by
 * reading yt-dlp's own InstagramStoryIE source: it hits the exact same
 * i.instagram.com/api/v1 endpoint family our disabled custom extractor did,
 * with no fallback the way ordinary-post extraction has) — it's a different
 * actor entirely, e.g. `datavoyantlab/advanced-instagram-stories-scraper`,
 * which needs no Instagram login of its own and returns data already shaped
 * like Instagram's native API (media_type/image_versions2/video_versions),
 * the same shape `server/extractors/instagram.ts`'s disabled extractor already
 * has parsing logic for. No default actor id: unlike the posts actor, this is
 * a separate paid subscription the owner has to consciously pick and enable,
 * so it stays fully inert (falls through to yt-dlp's "log in required" error)
 * until `APIFY_IG_STORY_ACTOR` is explicitly set.
 */

const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim().replace(/^["']|["']$/g, "");
const APIFY_IG_ACTOR = (process.env.APIFY_IG_ACTOR || "apify/instagram-scraper").trim();
const APIFY_THREADS_ACTOR = process.env.APIFY_THREADS_ACTOR?.trim();
const APIFY_IG_STORY_ACTOR = process.env.APIFY_IG_STORY_ACTOR?.trim();
const TIMEOUT_MS = Number(process.env.APIFY_TIMEOUT_MS || 120_000);
// The Threads actor only fetches a user's RECENT posts (no per-URL lookup), so
// we must pull enough to include the target. Higher = finds older posts but
// slower. Tune via APIFY_THREADS_MAX_POSTS (actor minimum is 10).
const THREADS_MAX_POSTS = Math.max(10, Number(process.env.APIFY_THREADS_MAX_POSTS) || 30);

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

/* -------------------------- Instagram Stories -------------------------- */

/**
 * Shaped like Instagram's OWN native `api/v1` response (media_type/
 * image_versions2/video_versions) — the dedicated Story actor returns data in
 * this form rather than the flattened `videoUrl`/`displayUrl` shape
 * `apify/instagram-scraper` uses for posts above. Deliberately the SAME field
 * names `server/extractors/instagram.ts`'s disabled custom extractor already
 * parses (`IgMedia`/`bestImage`), since both are describing the same
 * upstream API shape.
 *
 * 🔴 `video_versions` is inferred by strong analogy (every other field was
 * confirmed against the actor's published example output, which happened to
 * show a photo story) — NOT independently confirmed. If a real video story
 * comes back with zero formats where a photo one works fine, this is the
 * first thing to check: hit `/api/admin/debug?igstory=<username>` and look at
 * what key actually holds the video URL.
 */
interface IgStoryImageCandidate {
  url?: string;
  width?: number;
}
interface IgStoryVideoVersion {
  url?: string;
  width?: number;
}
interface IgStoryItem {
  id?: string;
  media_type?: number; // 1 = image, 2 = video
  video_versions?: IgStoryVideoVersion[];
  image_versions2?: { candidates?: IgStoryImageCandidate[] };
  user?: { username?: string };
  username?: string; // some actors flatten this to the top level instead
  error?: string;
}

function bestStoryUrl(candidates: { url?: string; width?: number }[] | undefined): string | null {
  const widest = (candidates ?? [])
    .filter((c): c is { url: string; width?: number } => !!c.url?.startsWith("http"))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return widest?.url ?? null;
}

/** One MediaFormat per Story slide — mirrors `tryStorySlides` (Facebook) and
 *  the yt-dlp playlist path (`mapPlaylistFormats` in ytdlp-service.ts):
 *  every real slide is a SEPARATE downloadable item, not a quality ladder. */
function igStoryFormats(items: IgStoryItem[]): MediaFormat[] {
  const formats: MediaFormat[] = [];
  items.forEach((item, i) => {
    if (item.error) return;
    const videoUrl = bestStoryUrl(item.video_versions);
    if (videoUrl) {
      formats.push({
        formatId: `ig-story-${i}`, kind: "video", label: `Story ${i + 1}`, ext: "mp4",
        resolution: null, fps: null, filesize: null, tbr: null,
        vcodec: "h264", acodec: "aac", directUrl: videoUrl, httpHeaders: IMG_HEADERS,
        isSeparateItem: true,
      });
      return;
    }
    const imgUrl = bestStoryUrl(item.image_versions2?.candidates);
    if (imgUrl) formats.push({ ...imageFormat(`ig-story-${i}`, `Story ${i + 1}`, imgUrl), isSeparateItem: true });
  });
  return formats;
}

/* ------------------------------ Threads ------------------------------ */

interface ThreadsItem {
  post_url?: string;
  url?: string;
  code?: string;
  shortcode?: string;
  pk?: string;
  media_url?: string;
  media_urls?: string[];
  media_type?: string;
  has_media?: boolean;
  has_audio?: boolean;
  text_content?: string;
  username?: string;
}

/** Find the post matching a Threads share code across the actor's result fields. */
function matchThreadsPost(items: ThreadsItem[], code: string): ThreadsItem | null {
  return (
    items.find((p) => (p.post_url || p.url || "").includes(`/post/${code}`)) ??
    items.find((p) => p.code === code || p.shortcode === code) ??
    items.find((p) => (p.post_url || p.url || "").includes(code)) ??
    null
  );
}

/** Diagnostic: run the Threads actor and report what it returned (admin debug). */
export async function apifyThreadsDiag(url: string): Promise<Record<string, unknown>> {
  const m = url.match(/threads\.(?:net|com)\/@([^/?]+)\/post\/([A-Za-z0-9_-]+)/i);
  const username = m?.[1];
  const code = m?.[2];
  if (!APIFY_TOKEN) return { error: "APIFY_TOKEN not set" };
  if (!APIFY_THREADS_ACTOR) return { error: "APIFY_THREADS_ACTOR not set" };
  if (!username || !code) return { error: "could not parse username/code", url };
  const items = (await runActor(APIFY_THREADS_ACTOR, {
    mode: "user",
    usernames: [username],
    max_posts: THREADS_MAX_POSTS,
  })) as ThreadsItem[] | null;
  if (!items) return { actor: APIFY_THREADS_ACTOR, username, code, count: null, note: "actor returned null/non-array" };
  const matched = matchThreadsPost(items, code);
  return {
    actor: APIFY_THREADS_ACTOR,
    username,
    code,
    maxPosts: THREADS_MAX_POSTS,
    count: items.length,
    matched: !!matched,
    matchedHasMedia: matched?.has_media ?? null,
    matchedMediaType: matched?.media_type ?? null,
    firstKeys: items[0] ? Object.keys(items[0]).slice(0, 20) : null,
    samplePostUrls: items.slice(0, 12).map((p) => (p.post_url || p.url || "").slice(-40)),
  };
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
    const runThreads = () =>
      runActor(APIFY_THREADS_ACTOR!, {
        mode: "user",
        usernames: [username],
        max_posts: THREADS_MAX_POSTS,
      }) as Promise<ThreadsItem[] | null>;
    // One retry: the actor occasionally returns null on a transient hiccup,
    // which otherwise surfaces as a misleading "private link" error.
    const items = (await runThreads()) ?? (await runThreads());
    if (!items) return null;
    const post = matchThreadsPost(items, code);
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
  /*
    🔴 Stories can't go through the "posts" path below (owner, 2026-08-17:
    first "takes ages" — `resultsType: "posts"` + `directUrls` asks the actor
    to resolve a POST, and a Story url is never one, so every call here just
    burned up to APIFY_TIMEOUT_MS for nothing; then, once that timeout drain
    was fixed, the REAL link still said "couldn't fetch" because Instagram
    Stories need a dedicated actor — see the module doc above.

    ytdlp-service.ts's canonicalizeUrl + playlist handling gets first crack at
    a Story url (cheaper, tried before this function is even called — see
    server/extractors/index.ts). This only runs at all once THAT has already
    failed with yt-dlp's `login_required` (confirmed via yt-dlp's own
    InstagramStoryIE source: it hits i.instagram.com/api/v1/feed/reels_media,
    the same endpoint family our own session has never been able to use, with
    no fallback the way ordinary posts have). A dedicated Story actor sidesteps
    that wall entirely by not depending on our session at all.
  */
  if (/\/stories\//i.test(url)) {
    if (!APIFY_IG_STORY_ACTOR) return null; // no actor configured — stays inert
    const m = url.match(/instagram\.com\/stories\/([^/?#]+)/i);
    const username = m?.[1];
    // Highlights are a curated collection identified by an id, not a live
    // username tray — this actor (and canonicalizeUrl's tray-root rewrite)
    // both assume "a username has a current story", which doesn't apply here.
    if (!username || username === "highlights") return null;
    const items = (await runActor(APIFY_IG_STORY_ACTOR, {
      usernames: [username],
    })) as IgStoryItem[] | null;
    if (!items?.length) return null;
    const formats = igStoryFormats(items);
    if (formats.length === 0) return null;
    return {
      id: username,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: `${username}'s Instagram Story`,
      description: null,
      thumbnail: formats[0]?.directUrl ?? null,
      durationSeconds: null,
      creator: items[0]?.user?.username || items[0]?.username || username,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "ytdlp",
    };
  }

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
