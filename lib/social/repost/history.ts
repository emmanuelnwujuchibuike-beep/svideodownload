import { createAdminClient } from "@/lib/supabase/admin";

import type { RepostAudience } from "./audience";
import { buildRipple, type Ripple, type RippleRow } from "./ripple";
import { filterVisibleReposts, relationTo, type RepostViewer } from "./visibility";

/**
 * The repost history of one reel — the Repost Page (Feature 15 · Part 4).
 *
 * "Every reel has its own repost history… Everything searchable."
 *
 * ── The audience gate runs before anything else ──────────────────────────
 * Every row goes through `filterVisibleReposts` the moment it arrives, BEFORE
 * tabs, before search, before counts. Filtering after would make the tab totals
 * describe rows the viewer may not see — and a count is enough to reveal that a
 * private repost exists.
 *
 * ── Tabs are views of one fetch, not four queries ────────────────────────
 * Friends, quotes and creators are all subsets of the same visible set, so the
 * page costs two round trips regardless of which tab is open, and switching
 * tabs costs nothing.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type RepostHistoryTab = "all" | "friends" | "quotes";

export interface RepostHistoryEntry {
  repostId: string;
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  caption: string | null;
  createdAt: string;
  audience: RepostAudience;
  isFriend: boolean;
  isFollowing: boolean;
  /** This repost travelled through another one. */
  viaRepost: boolean;
}

export interface RepostHistory {
  postId: string;
  entries: RepostHistoryEntry[];
  counts: { all: number; friends: number; quotes: number };
}

interface Row {
  id: string;
  user_id: string;
  caption: string | null;
  created_at: string;
  audience?: string | null;
  source_repost_id?: string | null;
}

async function visibleRows(postId: string, viewer: RepostViewer, limit = 200): Promise<Row[]> {
  const db = createAdminClient();
  const build = (cols: string) =>
    db.from("reposts").select(cols).eq("post_id", postId).order("created_at", { ascending: false }).limit(limit);

  // 0116 columns, degrading to the 0030 shape (see visibility.ts on why every
  // read here tolerates a missing column).
  const rich = await build("id, user_id, caption, created_at, audience, source_repost_id");
  const rows = (rich.error ? ((await build("id, user_id, caption, created_at")).data ?? []) : (rich.data ?? [])) as unknown as Row[];
  return filterVisibleReposts(
    rows.map((r) => ({ ...r, audience: (r.audience ?? "public") as RepostAudience })),
    viewer,
  );
}

/**
 * Reposters of a post, audience-filtered, with the viewer's own connections
 * first — the ordering `reposters-sheet.tsx` already established, kept because a
 * list of strangers is not what anyone opens this to see.
 */
export async function repostHistory(
  postId: string,
  viewer: RepostViewer,
  opts: { tab?: RepostHistoryTab; query?: string; limit?: number } = {},
): Promise<RepostHistory> {
  const empty: RepostHistory = { postId, entries: [], counts: { all: 0, friends: 0, quotes: 0 } };
  if (!hasSupabase) return empty;
  try {
    const rows = await visibleRows(postId, viewer);
    if (rows.length === 0) return empty;

    const db = createAdminClient();
    const { data: profs } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified")
      .in("id", [...new Set(rows.map((r) => r.user_id))]);
    const profById = new Map(
      ((profs ?? []) as {
        id: string;
        handle: string | null;
        display_name: string | null;
        avatar_url: string | null;
        is_verified: boolean | null;
      }[]).map((p) => [p.id, p]),
    );

    const all: RepostHistoryEntry[] = [];
    for (const r of rows) {
      const p = profById.get(r.user_id);
      if (!p?.handle) continue; // a profile we can't name is a row we can't render
      const rel = relationTo(r.user_id, viewer);
      all.push({
        repostId: r.id,
        userId: r.user_id,
        handle: p.handle,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        isVerified: !!p.is_verified,
        caption: r.caption,
        createdAt: r.created_at,
        audience: (r.audience ?? "public") as RepostAudience,
        isFriend: rel.isFriend,
        isFollowing: rel.follows,
        viaRepost: !!r.source_repost_id,
      });
    }

    const counts = {
      all: all.length,
      friends: all.filter((e) => e.isFriend || e.isFollowing).length,
      quotes: all.filter((e) => !!e.caption).length,
    };

    let entries = all;
    if (opts.tab === "friends") entries = entries.filter((e) => e.isFriend || e.isFollowing);
    else if (opts.tab === "quotes") entries = entries.filter((e) => !!e.caption);

    const q = opts.query?.trim().toLowerCase();
    if (q) {
      // Searches the handle, the display name and the recommendation itself —
      // the caption is the most useful thing on this page and the reason
      // "searchable" was asked for at all.
      entries = entries.filter(
        (e) =>
          e.handle.toLowerCase().includes(q) ||
          (e.displayName ?? "").toLowerCase().includes(q) ||
          (e.caption ?? "").toLowerCase().includes(q),
      );
    }

    // Connections first, then newest. Stable within each group.
    entries = [...entries].sort((a, b) => {
      const aConn = a.isFriend || a.isFollowing ? 1 : 0;
      const bConn = b.isFriend || b.isFollowing ? 1 : 0;
      return bConn - aConn || Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });

    return { postId, entries: entries.slice(0, opts.limit ?? 100), counts };
  } catch {
    return empty;
  }
}

/**
 * Social Ripple™ for a post — the audience-filtered rows, shaped into a tree.
 *
 * 🔴 Filtering before building matters more here than anywhere else: a hidden
 * row removed from the middle of a chain would leave its children pointing at a
 * parent the viewer cannot see, and `buildRipple` correctly re-seeds those as
 * untraceable. That is the right outcome — the alternative is drawing an edge
 * to a name the viewer was never allowed to know.
 */
export async function repostRipple(postId: string, viewer: RepostViewer): Promise<Ripple | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data: post } = await db.from("posts").select("publisher_id").eq("id", postId).maybeSingle();
    if (!post) return null;

    const rows = await visibleRows(postId, viewer, 300);
    const ids = [...new Set([post.publisher_id as string, ...rows.map((r) => r.user_id)])];
    const { data: profs } = await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids);
    const profById = new Map(
      ((profs ?? []) as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null }[]).map(
        (p) => [p.id, p],
      ),
    );
    const nameOf = (id: string) => {
      const p = profById.get(id);
      return p?.display_name || (p?.handle ? `@${p.handle}` : "Someone");
    };

    const rippleRows: RippleRow[] = rows.map((r) => ({
      repostId: r.id,
      reposterId: r.user_id,
      name: nameOf(r.user_id),
      avatarUrl: profById.get(r.user_id)?.avatar_url ?? null,
      sourceRepostId: r.source_repost_id ?? null,
      createdAt: Date.parse(r.created_at),
      isConnection: viewer.friends.has(r.user_id) || viewer.following.has(r.user_id),
    }));

    return buildRipple(
      {
        id: post.publisher_id as string,
        name: nameOf(post.publisher_id as string),
        avatarUrl: profById.get(post.publisher_id as string)?.avatar_url ?? null,
      },
      rippleRows,
    );
  } catch {
    return null;
  }
}
