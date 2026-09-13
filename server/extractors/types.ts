import type { PlatformId, VideoMetadata } from "@/types";

/**
 * A platform-specific extractor. Custom extractors talk directly to a site's
 * API/page for speed (no yt-dlp subprocess), and throw on any failure so the
 * registry can transparently fall back to yt-dlp.
 */
export interface Extractor {
  /** Stable identifier, also stored on the produced metadata. */
  name: string;
  /** Whether this extractor should attempt the given URL. */
  canHandle(url: string, platform: PlatformId): boolean;
  /** Resolve metadata + downloadable formats, or throw to trigger fallback. */
  extract(url: string): Promise<VideoMetadata>;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * The PLATFORM said the content is gone — not a scrape that missed.
 *
 * ── Owner, 2026-09-13: "https://snapchat.com/t/ypfUOJ0m — this link is
 * showing this" (the generic could-not-fetch sentence) ─────────────────────
 *
 * Probed: Snapchat answers that share link with its own app shell, status 404,
 * `videoMetadata.contentUrl` empty, and its own string for the page is
 * "This Snap is no longer available". The creator's public Spotlight rail is
 * empty. The clip is deleted or private; nothing on our side can change that.
 *
 * What the chain did with that verdict: fell back to yt-dlp (which fetched the
 * same 404), then re-ran BOTH through the residential proxy (Snapchat is
 * proxy-eligible), then surfaced yt-dlp's silence as the generic sentence.
 * ~10 s and paid proxy bytes to rediscover what the first response said.
 *
 * So a verdict is its own error type. `runChain` and `extractFresh` rethrow it
 * immediately — no yt-dlp, no Apify, no proxy — and the metadata route shows
 * `userMessage` verbatim. It is only thrown when the platform's OWN page
 * rendered and said so (see snapchat.ts); a bare 404 from an edge or a wall is
 * still a plain `ExtractionError`, and still gets every fallback.
 */
export class ContentUnavailableError extends ExtractionError {
  constructor(
    message: string,
    /** Safe to show a member verbatim. Names no URL and no account. */
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "ContentUnavailableError";
  }
}
