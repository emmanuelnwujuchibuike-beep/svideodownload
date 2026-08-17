/**
 * Shared domain types for FrenzSave.
 * Kept framework-agnostic so they can be imported by server services,
 * route handlers, and client components alike.
 */

export type PlatformId =
  | "tiktok"
  | "instagram"
  | "facebook"
  | "twitter"
  | "pinterest"
  | "reddit"
  | "vimeo"
  | "youtube"
  | "threads"
  | "snapchat"
  | "linkedin"
  | "telegram"
  | "generic";

export interface Platform {
  id: PlatformId;
  name: string;
  /** Hostnames (without protocol) that map to this platform. */
  hosts: string[];
  /** Tailwind gradient classes for the platform card accent. */
  accent: string;
  /**
   * Which foreground the accent needs to stay legible.
   *
   * Ships WITH `accent` because it is a property of that colour, not a styling
   * preference — and getting it wrong is an accessibility failure, not a cosmetic
   * one. Snapchat's brand yellow (#fffc00) against white text is roughly 1.07:1;
   * WCAG AA for large text is 3:1. Any surface that paints `accent` as a
   * background must read this rather than assuming white.
   */
  accentForeground: "light" | "dark";
  /** Whether we advertise watermark-free extraction for this platform. */
  watermarkFree: boolean;
  audioOnly?: boolean;
}

export type MediaKind = "video" | "audio" | "image";

/**
 * Reference to authenticated Telegram (MTProto) media, when there's no public CDN
 * URL to proxy. The download service re-resolves it through the worker's Telegram
 * client at download time (see server/services/telegram-mtproto.ts).
 */
export interface TelegramMediaRef {
  username?: string;
  channelId?: string;
  messageId?: number;
  storyId?: number;
  isStory?: boolean;
}

export interface MediaFormat {
  /** Download selector: a height tier ("1080"), "audio", or an extractor key. */
  formatId: string;
  kind: MediaKind;
  /** e.g. "1080p", "720p", "audio" */
  label: string;
  ext: string;
  resolution: string | null;
  fps: number | null;
  /** Size in bytes when known (approximate from yt-dlp). */
  filesize: number | null;
  /** Average bitrate in kbps when known. */
  tbr: number | null;
  vcodec: string | null;
  acodec: string | null;
  /**
   * Direct CDN URL produced by a custom extractor. When present the download is
   * served by proxying these bytes (no yt-dlp/ffmpeg) — the fast path. Resolved
   * server-side from cached metadata, never trusted from the client.
   */
  directUrl?: string | null;
  /** Headers required to fetch `directUrl` (e.g. Referer / User-Agent). */
  httpHeaders?: Record<string, string> | null;
  /**
   * True when this format is a DISTINCT piece of media rather than another
   * quality of the same one — a Snapchat story with several snaps, say.
   *
   * The distinction is load-bearing, not cosmetic. Formats are normally
   * alternatives, so the UI shows a picker and downloads exactly one. A story's
   * snaps are not alternatives: picking "Story 1" and stopping means the other
   * snaps are never downloaded at all, which is precisely the bug this flag
   * fixes. Formats marked this way are offered as a multi-select batch instead.
   *
   * Multi-photo posts are the same idea and predate this flag; they are still
   * detected by "more than one image format", so nothing about them changes.
   */
  isSeparateItem?: boolean;
  /**
   * A poster for THIS item specifically.
   *
   * Only meaningful alongside `isSeparateItem`: a batch of distinct media
   * needs a distinct picture per tile. Without it the grid falls back to the
   * post-level thumbnail, so every snap in a story rendered as the same image
   * and the picker was impossible to use — the owner's "each media should show
   * their respective cover and not a general cover".
   */
  thumbnail?: string | null;
  /**
   * Set ONLY on a synthesized lower-quality tier (see quality-ladder.ts): at
   * download time, `directUrl` is downscaled/re-encoded to this max height via
   * ffmpeg instead of proxied verbatim — so it's always a real, smaller,
   * validated file rather than a copy of whatever the source actually serves.
   */
  transcodeMaxHeight?: number | null;
  /**
   * Set on authenticated Telegram (private/Story) media that has no public URL.
   * The download service downloads it through the worker's MTProto client rather
   * than proxying/yt-dlp.
   */
  telegramRef?: TelegramMediaRef | null;
}

export type ExtractorName =
  | "tiktok"
  | "vimeo"
  | "twitter"
  | "instagram"
  | "facebook"
  | "pinterest"
  | "snapchat"
  | "threads"
  | "telegram"
  | "ytdlp";

export interface VideoMetadata {
  id: string;
  platform: PlatformId;
  platformName: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
  creator: string | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  webpageUrl: string;
  formats: MediaFormat[];
  /** Which extractor produced this metadata (for observability/debugging). */
  extractor: ExtractorName;
  /**
   * Natural pixel size of the best available format, when the extractor
   * reported it. Feeds `posts.media_width`/`media_height` on repost
   * (`PublishButton`) so the feed can size a post's media box correctly on
   * the FIRST paint instead of guessing — without this, every reposted/
   * downloaded post fell back to a generic aspect-ratio guess that visibly
   * corrected itself once the browser measured the real file, a jarring
   * resize on every single post (owner, 2026-08-17: "it still glitches and
   * show a wrong size... whenever i enter"). Optional — most extractors
   * don't populate it yet (only `ytdlp-service.ts` does, as of 2026-08-17);
   * every other extractor still constructs valid `VideoMetadata` without
   * it, same as before this field existed. Null for a multi-item playlist
   * (an Instagram Story tray) — each slide can have its own shape, and this
   * is one pair for the whole metadata object.
   */
  width?: number | null;
  height?: number | null;
}

/** A locally-persisted record of a download the user performed. */
export interface DownloadRecord {
  id: string;
  url: string;
  platform: PlatformId;
  platformName: string;
  title: string;
  thumbnail: string | null;
  formatId: string;
  kind: MediaKind;
  qualityLabel: string;
  /** Exact downloaded size in bytes, when known (recorded by the download manager). */
  size?: number | null;
  /**
   * Clip length in seconds, when the extractor reported one.
   *
   * Optional and often absent: it is only known for links whose metadata
   * included it, and every record downloaded before this field existed has
   * none. The history tile therefore shows a duration where there IS one and
   * just the media-kind glyph where there isn't — never a "0:00", which would
   * be a claim about the file rather than a gap in what we know.
   */
  durationSeconds?: number | null;
  createdAt: number;
  favorite: boolean;
}

export interface ApiError {
  error: string;
  code:
    | "INVALID_URL"
    | "UNSUPPORTED_PLATFORM"
    | "RATE_LIMITED"
    | "EXTRACTION_FAILED"
    | "DOWNLOAD_FAILED"
    | "TIMEOUT"
    | "INTERNAL"
    // Reward-session / download-authorization errors — see
    // lib/monetization/reward-sessions.ts's RewardErrorCode (same set).
    | "REWARD_SESSION_EXPIRED"
    | "REWARD_ALREADY_CONSUMED"
    | "REWARD_NOT_GRANTED"
    | "DAILY_LIMIT_REACHED"
    | "USER_NOT_ELIGIBLE"
    | "DOWNLOAD_NOT_FOUND"
    | "DOWNLOAD_TOKEN_EXPIRED"
    | "DOWNLOAD_TOKEN_USED"
    | "BATCH_NOT_FOUND"
    | "QUALITY_NOT_AVAILABLE"
    | "AD_UNAVAILABLE"
    | "FEATURE_DISABLED"
    | "INVALID_REQUEST";
}

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);
