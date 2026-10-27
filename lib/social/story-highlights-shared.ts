/**
 * Story highlights — the client-safe half (types, limits, the title rule). The server half, which reads and writes
 * the tables, is lib/social/story-highlights.ts; it re-exports all of this.
 */

export const HIGHLIGHT_TITLE_MAX = 30;
export const MAX_HIGHLIGHTS = 100;
export const MAX_HIGHLIGHT_ITEMS = 100;

export interface HighlightItem {
  id: string;
  mediaUrl: string;
  mediaKind: "image" | "video";
  thumbnailUrl: string | null;
  caption: string | null;
  /** When the story was first posted. */
  createdAt: string;
}

export interface Highlight {
  id: string;
  userId: string;
  title: string;
  /** The chosen cover, else the newest story's picture. Null only for an empty highlight (never shown). */
  coverUrl: string | null;
  itemCount: number;
  /** Owner lists only, with `?story=`: does this highlight already hold that story? */
  containsStory?: boolean;
}

export interface HighlightWithItems extends Highlight {
  items: HighlightItem[];
}

/** A highlight title, cleaned: trimmed, inner whitespace collapsed, 1–30 characters. Null when unusable. */
export function normalizeHighlightTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return [...t].length <= HIGHLIGHT_TITLE_MAX ? t : null;
}

/** The picture a story shows as a cover: a video's poster, an image itself. */
export function coverOf(item: { mediaKind: string; mediaUrl: string; thumbnailUrl: string | null }): string | null {
  return item.mediaKind === "video" ? item.thumbnailUrl : item.mediaUrl;
}
