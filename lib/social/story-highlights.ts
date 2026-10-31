import {
  coverOf,
  HIGHLIGHT_TITLE_MAX,
  MAX_HIGHLIGHT_ITEMS,
  MAX_HIGHLIGHTS,
  normalizeHighlightTitle,
  type Highlight,
  type HighlightItem,
  type HighlightWithItems,
} from "@/lib/social/story-highlights-shared";
import { canSeeStoriesOf } from "@/lib/social/stories";
import { releaseUnreferencedUploads } from "@/lib/storage/release-unreferenced";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STORY HIGHLIGHTS (Stories Part 5, 2026-10-27; migration 0289)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "build everything so nothing is fake or coming soon in the story features". A member keeps their own stories
 * past 24 hours in named highlights, shown as circles on their profile.
 *
 *   WHO SEES    whoever may see the member's stories (canSeeStoriesOf — the rings' one rule: blocks and restrictions both
 *               ways, profile visibility, ties). The owner always. A refusal reads as "no highlights", never an error.
 *   WHO WRITES  the owner only, and only their OWN stories (checked on the story row). Every write is the server's
 *               (the tables have no member access, like stories since 0285).
 *   THE FILE    an item COPIES the story's media reference when added, so it outlives the story row; the daily sweep
 *               never deletes a file a highlight names (story_media_references reads every *_url column). When an item
 *               or a highlight goes, its files are deleted only if nothing else uses them (release-unreferenced.ts).
 *   LIMITS      30-character titles, 100 highlights per member, 100 stories per highlight. A highlight whose last story
 *               is removed is deleted with it (an empty circle would show nothing).
 */

export { coverOf, HIGHLIGHT_TITLE_MAX, MAX_HIGHLIGHT_ITEMS, MAX_HIGHLIGHTS, normalizeHighlightTitle };
export type { Highlight, HighlightItem, HighlightWithItems };

export type HighlightFailure = "not_found" | "not_yours" | "story_not_found" | "bad_title" | "too_many_highlights" | "full" | "unavailable";
export type HighlightResult<T> = { ok: true; value: T } | { ok: false; reason: HighlightFailure };

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

type HighlightRow = { id: string; user_id: string; title: string; cover_url: string | null; position: number; created_at: string };
type ItemRow = {
  id: string;
  highlight_id: string;
  source_story_id: string | null;
  media_url: string;
  media_kind: "image" | "video";
  thumbnail_url: string | null;
  caption: string | null;
  story_created_at: string;
};

const ITEM_COLUMNS = "id, highlight_id, source_story_id, media_url, media_kind, thumbnail_url, caption, story_created_at";

function toItem(r: ItemRow): HighlightItem {
  return { id: r.id, mediaUrl: r.media_url, mediaKind: r.media_kind, thumbnailUrl: r.thumbnail_url, caption: r.caption, createdAt: r.story_created_at };
}

/**
 * Pure: a member's highlights from their rows — newest first, each with its count and cover (the chosen one, else the
 * newest story's picture). Empty highlights are left out.
 */
export function assembleHighlights(rows: readonly HighlightRow[], items: readonly ItemRow[], containing?: string | null): Highlight[] {
  const byHighlight = new Map<string, ItemRow[]>();
  for (const it of items) {
    const list = byHighlight.get(it.highlight_id) ?? [];
    list.push(it);
    byHighlight.set(it.highlight_id, list);
  }
  return [...rows]
    .sort((a, b) => a.position - b.position || b.created_at.localeCompare(a.created_at))
    .flatMap((h) => {
      const list = (byHighlight.get(h.id) ?? []).sort((a, b) => b.story_created_at.localeCompare(a.story_created_at));
      if (!list.length) return [];
      const newest = list[0]!;
      const out: Highlight = {
        id: h.id,
        userId: h.user_id,
        title: h.title,
        coverUrl: h.cover_url ?? coverOf(toItem(newest)),
        itemCount: list.length,
      };
      if (containing !== undefined) out.containsStory = !!containing && list.some((i) => i.source_story_id === containing);
      return [out];
    });
}

/** A member's highlights as this viewer may see them. Empty when they may not (or on any error). */
export async function listHighlights(ownerId: string, viewerId: string | null, opts: { containingStory?: string | null } = {}): Promise<Highlight[]> {
  if (!hasSupabase) return [];
  try {
    if (!(await canSeeStoriesOf(ownerId, viewerId))) return [];
    const db = createAdminClient();
    const { data: rows, error } = await db.from("story_highlights").select("id, user_id, title, cover_url, position, created_at").eq("user_id", ownerId).limit(MAX_HIGHLIGHTS);
    if (error || !rows?.length) return [];
    const { data: items } = await db
      .from("story_highlight_items")
      .select(ITEM_COLUMNS)
      .in("highlight_id", rows.map((r) => r.id))
      .limit(MAX_HIGHLIGHTS * MAX_HIGHLIGHT_ITEMS);
    // `containsStory` is only ever worked out for the owner's own list (the picker)
    const containing = viewerId === ownerId && opts.containingStory !== undefined ? opts.containingStory : undefined;
    return assembleHighlights(rows as HighlightRow[], (items ?? []) as ItemRow[], containing);
  } catch {
    return [];
  }
}

/** One highlight with its stories, oldest first (the order they were lived). Null when missing or not visible. */
export async function getHighlight(id: string, viewerId: string | null): Promise<HighlightWithItems | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data: h } = await db.from("story_highlights").select("id, user_id, title, cover_url, position, created_at").eq("id", id).maybeSingle();
    if (!h) return null;
    if (!(await canSeeStoriesOf(h.user_id as string, viewerId))) return null;
    const { data: items } = await db.from("story_highlight_items").select(ITEM_COLUMNS).eq("highlight_id", id).order("story_created_at", { ascending: true }).limit(MAX_HIGHLIGHT_ITEMS);
    const list = (items ?? []) as ItemRow[];
    if (!list.length) return null;
    const [summary] = assembleHighlights([h as HighlightRow], list);
    return summary ? { ...summary, items: list.map(toItem) } : null;
  } catch {
    return null;
  }
}

type Db = ReturnType<typeof createAdminClient>;

/** The member's OWN story, still in the table (live, or ended but not yet swept). */
async function ownStory(db: Db, userId: string, storyId: string) {
  const { data } = await db.from("stories").select("id, user_id, media_url, media_kind, thumbnail_url, caption, created_at").eq("id", storyId).maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data as { id: string; media_url: string; media_kind: "image" | "video"; thumbnail_url: string | null; caption: string | null; created_at: string };
}

/** The member's OWN highlight row. */
async function ownHighlight(db: Db, userId: string, id: string): Promise<HighlightRow | "not_found" | "not_yours"> {
  const { data } = await db.from("story_highlights").select("id, user_id, title, cover_url, position, created_at").eq("id", id).maybeSingle();
  if (!data) return "not_found";
  return data.user_id === userId ? (data as HighlightRow) : "not_yours";
}

async function insertItems(db: Db, userId: string, highlightId: string, storyIds: readonly string[]): Promise<number> {
  let added = 0;
  for (const sid of storyIds) {
    const s = await ownStory(db, userId, sid);
    if (!s) continue;
    const { error } = await db.from("story_highlight_items").upsert(
      {
        highlight_id: highlightId,
        user_id: userId,
        source_story_id: s.id,
        media_url: s.media_url,
        media_kind: s.media_kind,
        thumbnail_url: s.thumbnail_url,
        caption: s.caption,
        story_created_at: s.created_at,
      },
      { onConflict: "highlight_id,source_story_id", ignoreDuplicates: true },
    );
    if (!error) added += 1;
  }
  return added;
}

const touch = (db: Db, id: string) => db.from("story_highlights").update({ updated_at: new Date().toISOString() }).eq("id", id);

/** A new highlight holding the given stories of the member's own. */
export async function createHighlight(userId: string, rawTitle: unknown, storyIds: readonly string[]): Promise<HighlightResult<{ id: string }>> {
  const title = normalizeHighlightTitle(rawTitle);
  if (!title) return { ok: false, reason: "bad_title" };
  if (!storyIds.length) return { ok: false, reason: "story_not_found" };
  try {
    const db = createAdminClient();
    const { count } = await db.from("story_highlights").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= MAX_HIGHLIGHTS) return { ok: false, reason: "too_many_highlights" };
    // every story must be the member's own before anything is written
    for (const sid of storyIds) if (!(await ownStory(db, userId, sid))) return { ok: false, reason: "story_not_found" };
    const { data: h, error } = await db.from("story_highlights").insert({ user_id: userId, title }).select("id").single();
    if (error || !h) return { ok: false, reason: "unavailable" };
    const added = await insertItems(db, userId, h.id as string, storyIds.slice(0, MAX_HIGHLIGHT_ITEMS));
    if (!added) {
      await db.from("story_highlights").delete().eq("id", h.id);
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, value: { id: h.id as string } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Add one of the member's own stories to their highlight. Adding a story it already holds is a success. */
export async function addStoryToHighlight(userId: string, highlightId: string, storyId: string): Promise<HighlightResult<{ added: boolean }>> {
  try {
    const db = createAdminClient();
    const h = await ownHighlight(db, userId, highlightId);
    if (typeof h === "string") return { ok: false, reason: h };
    if (!(await ownStory(db, userId, storyId))) return { ok: false, reason: "story_not_found" };
    const { data: already } = await db.from("story_highlight_items").select("id").eq("highlight_id", highlightId).eq("source_story_id", storyId).maybeSingle();
    if (already) return { ok: true, value: { added: false } };
    const { count } = await db.from("story_highlight_items").select("id", { count: "exact", head: true }).eq("highlight_id", highlightId);
    if ((count ?? 0) >= MAX_HIGHLIGHT_ITEMS) return { ok: false, reason: "full" };
    const added = await insertItems(db, userId, highlightId, [storyId]);
    if (!added) return { ok: false, reason: "unavailable" };
    await touch(db, highlightId);
    return { ok: true, value: { added: true } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Take a story out of a highlight — by the item, or by the story it came from. The last one out deletes the
 * highlight. Files nothing else uses any more are deleted after.
 */
export async function removeFromHighlight(
  userId: string,
  highlightId: string,
  which: { itemId?: string; storyId?: string },
): Promise<HighlightResult<{ highlightDeleted: boolean }>> {
  try {
    const db = createAdminClient();
    const h = await ownHighlight(db, userId, highlightId);
    if (typeof h === "string") return { ok: false, reason: h };
    let q = db.from("story_highlight_items").select(ITEM_COLUMNS).eq("highlight_id", highlightId);
    q = which.itemId ? q.eq("id", which.itemId) : q.eq("source_story_id", which.storyId ?? "");
    const { data: item } = await q.maybeSingle();
    if (!item) return { ok: false, reason: "not_found" };
    const row = item as ItemRow;
    const { error } = await db.from("story_highlight_items").delete().eq("id", row.id);
    if (error) return { ok: false, reason: "unavailable" };

    const released = [row.media_url, row.thumbnail_url];
    const { count } = await db.from("story_highlight_items").select("id", { count: "exact", head: true }).eq("highlight_id", highlightId);
    let highlightDeleted = false;
    if ((count ?? 0) === 0) {
      await db.from("story_highlights").delete().eq("id", highlightId);
      highlightDeleted = true;
    } else {
      // a cover that was this story's picture goes back to "the newest story"
      if (h.cover_url && (h.cover_url === row.media_url || h.cover_url === row.thumbnail_url)) await db.from("story_highlights").update({ cover_url: null }).eq("id", highlightId);
      await touch(db, highlightId);
    }
    await releaseUnreferencedUploads(released);
    return { ok: true, value: { highlightDeleted } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Rename a highlight and/or pick one of its own stories as the cover. */
export async function updateHighlight(userId: string, highlightId: string, patch: { title?: unknown; coverItemId?: string | null }): Promise<HighlightResult<null>> {
  try {
    const db = createAdminClient();
    const h = await ownHighlight(db, userId, highlightId);
    if (typeof h === "string") return { ok: false, reason: h };
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) {
      const title = normalizeHighlightTitle(patch.title);
      if (!title) return { ok: false, reason: "bad_title" };
      update.title = title;
    }
    if (patch.coverItemId !== undefined) {
      if (patch.coverItemId === null) update.cover_url = null;
      else {
        const { data: it } = await db.from("story_highlight_items").select(ITEM_COLUMNS).eq("id", patch.coverItemId).eq("highlight_id", highlightId).maybeSingle();
        if (!it) return { ok: false, reason: "not_found" };
        update.cover_url = coverOf(toItem(it as ItemRow));
      }
    }
    const { error } = await db.from("story_highlights").update(update).eq("id", highlightId);
    return error ? { ok: false, reason: "unavailable" } : { ok: true, value: null };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Delete a highlight and everything in it; files nothing else uses are deleted after. */
export async function deleteHighlight(userId: string, highlightId: string): Promise<HighlightResult<null>> {
  try {
    const db = createAdminClient();
    const h = await ownHighlight(db, userId, highlightId);
    if (typeof h === "string") return { ok: false, reason: h };
    const { data: items } = await db.from("story_highlight_items").select("media_url, thumbnail_url").eq("highlight_id", highlightId);
    const { error } = await db.from("story_highlights").delete().eq("id", highlightId);
    if (error) return { ok: false, reason: "unavailable" };
    await releaseUnreferencedUploads([...(items ?? []).flatMap((i) => [i.media_url as string, i.thumbnail_url as string | null]), h.cover_url]);
    return { ok: true, value: null };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Plain words for each refusal — one list for every route. */
export const HIGHLIGHT_ERRORS: Record<HighlightFailure, { msg: string; status: number }> = {
  not_found: { msg: "That highlight isn't there any more.", status: 404 },
  not_yours: { msg: "You can only change your own highlights.", status: 403 },
  story_not_found: { msg: "Only your own stories can go in your highlights.", status: 404 },
  bad_title: { msg: `Give it a name of up to ${HIGHLIGHT_TITLE_MAX} characters.`, status: 400 },
  too_many_highlights: { msg: `You can have up to ${MAX_HIGHLIGHTS} highlights.`, status: 409 },
  full: { msg: `A highlight holds up to ${MAX_HIGHLIGHT_ITEMS} stories.`, status: 409 },
  unavailable: { msg: "Couldn't update your highlights right now. Try again.", status: 503 },
};

/* ─────────────────────────────────────────────────────────────────────────────
   WHO VIEWED IT (owner, 2026-10-31: "I want users to see who views their highlight"; migration 0312)
   A view is somebody ELSE opening the highlight, recorded once — the first time — and only when they may see the
   owner's stories right now (the same rule that let them open it). The list is the owner's alone.
   ───────────────────────────────────────────────────────────────────────── */

export interface HighlightViewer {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  viewedAt: string;
}

/** recorded: the row exists after this call. A failed write is false and never surfaces to the person watching. */
export async function recordHighlightView(highlightId: string, viewerId: string): Promise<{ recorded: boolean }> {
  if (!hasSupabase) return { recorded: false };
  try {
    const db = createAdminClient();
    const { data: h } = await db.from("story_highlights").select("id, user_id").eq("id", highlightId).maybeSingle();
    if (!h || (h.user_id as string) === viewerId) return { recorded: false };
    if (!(await canSeeStoriesOf(h.user_id as string, viewerId))) return { recorded: false };
    // ignoreDuplicates: a re-open never moves viewed_at — the owner sees when somebody FIRST saw it
    const { error } = await db
      .from("story_highlight_views")
      .upsert({ highlight_id: highlightId, viewer_id: viewerId }, { onConflict: "highlight_id,viewer_id", ignoreDuplicates: true });
    return { recorded: !error };
  } catch {
    return { recorded: false };
  }
}

/** The owner's viewer list, newest first (200 at most) with the REAL total. `null` total = not countable (0312 not applied). */
export async function listHighlightViewers(
  ownerId: string,
  highlightId: string,
): Promise<HighlightResult<{ total: number | null; viewers: HighlightViewer[] }>> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  try {
    const db = createAdminClient();
    const own = await ownHighlight(db, ownerId, highlightId);
    if (own === "not_found" || own === "not_yours") return { ok: false, reason: own };
    const { data, error, count } = await db
      .from("story_highlight_views")
      .select("viewer_id, viewed_at", { count: "exact" })
      .eq("highlight_id", highlightId)
      .order("viewed_at", { ascending: false })
      .limit(200);
    // the table not there yet: an honest "not countable", never a made-up 0
    if (error) return { ok: true, value: { total: null, viewers: [] } };
    const rows = (data ?? []) as { viewer_id: string; viewed_at: string }[];
    const ids = rows.map((r) => r.viewer_id);
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids) : { data: [] as Record<string, unknown>[] };
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p as Record<string, unknown>]));
    return {
      ok: true,
      value: {
        total: count ?? rows.length,
        viewers: rows.map((r) => {
          const p = byId.get(r.viewer_id);
          return {
            id: r.viewer_id,
            handle: (p?.handle as string | null) ?? null,
            displayName: (p?.display_name as string | null) ?? null,
            avatarUrl: (p?.avatar_url as string | null) ?? null,
            viewedAt: r.viewed_at,
          };
        }),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
