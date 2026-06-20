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
