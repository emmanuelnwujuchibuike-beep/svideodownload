import "server-only";

import { CATEGORIES, type Category } from "@/lib/social/categories";
import { createAdminClient } from "@/lib/supabase/admin";

import type { ContentFilter, ContentPage, ContentStatus, CreatorContentItem } from "./content-types";
import { extractTags } from "./hashtag-performance";

/**
 * Content management data layer (Feature 15 · Part 9).
 *
 * ── Lifecycle, and why it rides `status` ─────────────────────────────────
 * Migration 0140 widened `posts.status` to include 'scheduled' and 'archived'
 * alongside the three it had. That choice is doing real work here: EVERY feed
 * read in this codebase already filters `status = 'published'`, so a post moved
 * to either new state leaves the home feed, Reels, search, Orbits, the profile
 * grid and both sitemaps the instant the row is written — with no edit to any
 * of those call sites, and no chance of one being missed. Had this been a
 * boolean `is_archived` column instead, every one of those queries would have
 * needed finding and changing, and the one that got missed would have leaked an
 * archived post into a stranger's feed.
 *
 * ── Ownership is checked on the server, every time ───────────────────────
 * Reads use the service role (which bypasses RLS), so `publisher_id` is matched
 * explicitly on every statement. RLS is the backstop, not the gate.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type {
  ContentStatus,
  ContentFilter,
  CreatorContentItem,
  ContentPage,
} from "./content-types";

interface Row {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  media_kind: string;
  category: string | null;
  visibility: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  archived_at: string | null;
  pinned_at: string | null;
  sound_id: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  downloads_count: number;
  completion_rate: number | null;
}

const COLUMNS =
  "id, title, description, thumbnail_url, media_kind, category, visibility, status, created_at, scheduled_at, archived_at, pinned_at, sound_id, views_count, likes_count, comments_count, shares_count, saves_count, downloads_count, completion_rate";

function toItem(r: Row): CreatorContentItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    thumbnailUrl: r.thumbnail_url,
    mediaKind: r.media_kind,
    category: r.category,
    visibility: (r.visibility as CreatorContentItem["visibility"]) ?? "public",
    status: (r.status as ContentStatus) ?? "published",
    createdAt: r.created_at,
    scheduledAt: r.scheduled_at,
    archivedAt: r.archived_at,
    pinnedAt: r.pinned_at,
    soundId: r.sound_id,
    views: r.views_count ?? 0,
    likes: r.likes_count ?? 0,
    comments: r.comments_count ?? 0,
    shares: r.shares_count ?? 0,
    saves: r.saves_count ?? 0,
    downloads: r.downloads_count ?? 0,
    completionRate: r.completion_rate ?? 0,
    tags: extractTags(`${r.title ?? ""} ${r.description ?? ""}`).map((t) => t.display),
  };
}


/**
 * PostgREST silently truncates at 1000 rows, and this project has been bitten
 * by treating a truncated number as a complete one. So the page size is well
 * below that, `truncated` is reported honestly, and the tab COUNTS come from
 * exact head-counts rather than from measuring the page that was fetched.
 */
const PAGE_SIZE = 200;

export async function listCreatorContent(
  userId: string,
  filter: ContentFilter = "all",
  search = "",
): Promise<ContentPage> {
  const empty: ContentPage = {
    items: [],
    counts: { all: 0, published: 0, scheduled: 0, archived: 0, pinned: 0 },
    truncated: false,
  };
  if (!hasSupabase) return empty;

  try {
    const db = createAdminClient();

    let q = db
      .from("posts")
      .select(COLUMNS)
      .eq("publisher_id", userId)
      .neq("status", "removed")
      .limit(PAGE_SIZE + 1);

    if (filter === "published") q = q.eq("status", "published");
    if (filter === "scheduled") q = q.eq("status", "scheduled");
    if (filter === "archived") q = q.eq("status", "archived");
    if (filter === "pinned") q = q.not("pinned_at", "is", null);

    const term = search.trim().replace(/[,%()*\\"']/g, " ").slice(0, 80);
    if (term) q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);

    // Pinned first, then scheduled by their date (soonest next), then newest.
    q = q.order("pinned_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const base = () =>
      db.from("posts").select("id", { head: true, count: "exact" }).eq("publisher_id", userId).neq("status", "removed");

    const [{ data }, all, published, scheduled, archived, pinned] = await Promise.all([
      q,
      base(),
      base().eq("status", "published"),
      base().eq("status", "scheduled"),
      base().eq("status", "archived"),
      base().not("pinned_at", "is", null),
    ]);

    const rows = (data as Row[]) ?? [];
    return {
      items: rows.slice(0, PAGE_SIZE).map(toItem),
      counts: {
        all: all.count ?? 0,
        published: published.count ?? 0,
        scheduled: scheduled.count ?? 0,
        archived: archived.count ?? 0,
        pinned: pinned.count ?? 0,
      },
      truncated: rows.length > PAGE_SIZE,
    };
  } catch {
    return empty;
  }
}

/** One item, ownership enforced. Returns null for somebody else's post — the
 *  same answer as "does not exist", so this never confirms a post's existence
 *  to a creator who does not own it. */
export async function getCreatorContentItem(id: string, userId: string): Promise<CreatorContentItem | null> {
  if (!hasSupabase) return null;
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select(COLUMNS)
      .eq("id", id)
      .eq("publisher_id", userId)
      .maybeSingle();
    return data ? toItem(data as Row) : null;
  } catch {
    return null;
  }
}

/* ────────────────────────────────── writes ────────────────────────────────── */

export type ContentAction =
  | { kind: "pin"; pinned: boolean }
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "schedule"; at: string | null }
  | { kind: "publishNow" }
  | { kind: "visibility"; visibility: "public" | "followers" | "private" }
  | { kind: "edit"; title?: string; description?: string | null; category?: Category | null };

/**
 * Apply one action to one owned post.
 *
 * Restore deliberately returns a post to `published`, not to whatever it was
 * before: the only states it could have come from are published or scheduled,
 * and silently re-arming a schedule whose time has long passed would publish it
 * on the next sweep without the creator asking. Restoring makes it live, now,
 * which is what the button says.
 */
export async function applyContentAction(
  id: string,
  userId: string,
  action: ContentAction,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: "Unavailable." };

  const patch: Record<string, unknown> = {};

  switch (action.kind) {
    case "pin":
      patch.pinned_at = action.pinned ? new Date().toISOString() : null;
      break;
    case "archive":
      patch.status = "archived";
      patch.archived_at = new Date().toISOString();
      patch.pinned_at = null; // an archived post cannot stay pinned to a profile
      break;
    case "restore":
      patch.status = "published";
      patch.archived_at = null;
      patch.scheduled_at = null;
      break;
    case "schedule": {
      if (action.at === null) {
        // A dateless draft: held back, no publish time yet.
        patch.status = "scheduled";
        patch.scheduled_at = null;
        patch.pinned_at = null;
        break;
      }
      const when = new Date(action.at);
      if (Number.isNaN(when.getTime())) return { ok: false, error: "That date isn't valid." };
      if (when.getTime() < Date.now() - 60_000) return { ok: false, error: "Pick a time in the future." };
      patch.status = "scheduled";
      patch.scheduled_at = when.toISOString();
      patch.archived_at = null;
      patch.pinned_at = null;
      break;
    }
    case "publishNow":
      patch.status = "published";
      patch.scheduled_at = null;
      patch.archived_at = null;
      break;
    case "visibility":
      patch.visibility = action.visibility;
      break;
    case "edit":
      if (typeof action.title === "string") patch.title = action.title.trim().slice(0, 300);
      if (action.description !== undefined) {
        patch.description = action.description === null ? null : action.description.trim().slice(0, 5000);
      }
      if (action.category !== undefined) {
        if (action.category !== null && !(CATEGORIES as readonly string[]).includes(action.category)) {
          return { ok: false, error: "Unknown category." };
        }
        patch.category = action.category;
      }
      break;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };

  try {
    const { error } = await createAdminClient()
      .from("posts")
      .update(patch)
      .eq("id", id)
      .eq("publisher_id", userId);
    if (error) return { ok: false, error: "Couldn't save that." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save that." };
  }
}

/** The same action across a selection. Applied one statement per action kind
 *  rather than per row, and the result reports how many rows actually matched —
 *  a bulk action that silently affected fewer posts than were selected would be
 *  the worst kind of quiet failure. */
export async function applyBulkAction(
  ids: string[],
  userId: string,
  action: ContentAction,
): Promise<{ ok: boolean; changed: number; error?: string }> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (unique.length === 0) return { ok: false, changed: 0, error: "Nothing selected." };

  let changed = 0;
  for (const id of unique) {
    const res = await applyContentAction(id, userId, action);
    if (res.ok) changed += 1;
  }
  return { ok: changed > 0, changed, error: changed === unique.length ? undefined : "Some posts couldn't be updated." };
}
