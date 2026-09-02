/**
 * Content-management shapes — the PURE half (Feature 15 · Part 9).
 *
 * 🔴 CLIENT-SAFE. No Supabase, no `server-only`, no I/O.
 * See `./plan-kinds.ts` for why this split exists at all.
 *
 * `content-manager.tsx` is `"use client"` and needs these types. A type-only
 * import from `./content.ts` would still pull that module's graph — and with it
 * `server-only` — into the browser bundle. TypeScript erases the type; webpack
 * still followed the edge.
 */

export type ContentStatus = "published" | "scheduled" | "archived" | "under_review" | "removed";
export type ContentFilter = "all" | "published" | "scheduled" | "archived" | "pinned";

export interface CreatorContentItem {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  mediaKind: string;
  category: string | null;
  visibility: "public" | "followers" | "private";
  status: ContentStatus;
  createdAt: string;
  scheduledAt: string | null;
  archivedAt: string | null;
  pinnedAt: string | null;
  soundId: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  downloads: number;
  /** Watch-through from the materialized column (migration 0133). */
  completionRate: number;
  /** Parsed out of the caption — the only place tags live. */
  tags: string[];
}

export interface ContentPage {
  items: CreatorContentItem[];
  counts: Record<ContentFilter, number>;
  /** True when the query hit its ceiling and more rows exist beyond it. */
  truncated: boolean;
}
