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
   * Set ONLY on a synthesized lower-quality tier (see quality-ladder.ts): at
   * download time, `directUrl` is downscaled/re-encoded to this max height via
   * ffmpeg instead of proxied verbatim — so it's always a real, smaller,
   * validated file rather than a copy of whatever the source actually serves.
   */
  transcodeMaxHeight?: number | null;
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
    | "INTERNAL";
}

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);
