/** Fixed content taxonomy (Phase 1). Free-form tags can come later. */
export const CATEGORIES = [
  "music",
  "gaming",
  "news",
  "sports",
  "comedy",
  "education",
  "dance",
  "food",
  "beauty",
  "tech",
  "travel",
  "animals",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

export function categoryLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}
