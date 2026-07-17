import { createAdminClient } from "@/lib/supabase/admin";

import { flagsOf, isAccountVisibleTo, relationTo } from "./account-visibility";
import { friendIdSet } from "./friend-ids";
import type { MediaKind } from "./posts";

/**
 * "Discover people" — a grid of fresh public media (videos & photos) from
 * creators the viewer does NOT already follow or is friends with. Powers the
 * bottom of /friends so there's always someone new to meet. Privacy always wins
 * (suspended / opted-out / blocked / private creators are removed).
 *
 * When a location is known — the viewer's profile location, or (fallback) their
 * IP country — creators in the same place float to the top so discovery feels
 * local. Location is best-effort: the `location` column may not be migrated yet,
 * in which case ranking silently falls back to freshness.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface DiscoveryItem {
  id: string;
  title: string;
  mediaKind: MediaKind;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  streamUid: string | null;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  /** True when this creator shares the viewer's location (used for the "near you" flag). */
  nearby: boolean;
}

export interface DiscoveryResult {
  items: DiscoveryItem[];
  /** Whether any location signal was available (drives the "near you" copy). */
  located: boolean;
  /** Pass back as `offset` to fetch the next page; null once exhausted. */
  nextOffset: number | null;
}

interface PostRow {
  id: string;
  publisher_id: string;
  media_kind: MediaKind;
  title: string;
  thumbnail_url: string | null;
  media_url: string | null;
  stream_uid: string | null;
  created_at: string;
}

const SELECT = "id, publisher_id, media_kind, title, thumbnail_url, media_url, stream_uid, created_at";

const WINDOW = 200;

export async function getDiscoveryFeed(
  viewerId: string | null,
  opts: { limit?: number; offset?: number; viewerLocation?: string | null } = {},
): Promise<DiscoveryResult> {
  const limit = opts.limit ?? 12;
  const offset = Math.max(0, opts.offset ?? 0);
  if (!hasSupabase) return { items: [], located: false, nextOffset: null };
  try {
    const db = createAdminClient();

    // Who to exclude: yourself, people you follow, and your friends.
    const exclude = new Set<string>();
    if (viewerId) {
      exclude.add(viewerId);
      const [{ data: follows }, { data: friends }] = await Promise.all([
        db.from("follows").select("following_id").eq("follower_id", viewerId),
        db
          .from("friendships")
          .select("user_low, user_high")
          .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`),
      ]);
      for (const f of ((follows ?? []) as { following_id: string }[])) exclude.add(f.following_id);
      for (const r of ((friends ?? []) as { user_low: string; user_high: string }[])) {
        exclude.add(r.user_low === viewerId ? r.user_high : r.user_low);
      }
    }

    // Fresh public media — over-fetch to absorb exclusions + per-creator capping.
    // `offset`/WINDOW paginate the raw query; a full window means there may be
    // more after it, a short one means the table's exhausted.
    const { data } = await db
      .from("posts")
      .select(SELECT)
      .eq("status", "published")
      .eq("visibility", "public")
      .in("media_kind", ["video", "image"])
      .order("created_at", { ascending: false })
      .range(offset, offset + WINDOW - 1);
    const nextOffset = (data?.length ?? 0) === WINDOW ? offset + WINDOW : null;
    const rows = ((data ?? []) as PostRow[]).filter((r) => !exclude.has(r.publisher_id));
    if (rows.length === 0) return { items: [], located: false, nextOffset };

    const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
    const [profsRes, { data: privs }, blocksRes] = await Promise.all([
      // `location` is best-effort — select it, fall back to the base columns if absent.
      db
        .from("profiles")
        .select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden, location")
        .in("id", publisherIds),
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);

    let profs = (profsRes.data ?? []) as Record<string, unknown>[];
    if (profsRes.error) {
      // Location column not migrated yet — retry without it.
      const { data: base } = await db
        .from("profiles")
        .select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden")
        .in("id", publisherIds);
      profs = (base ?? []) as Record<string, unknown>[];
    }

    const profById = new Map<string, Record<string, unknown>>();
    for (const p of profs) profById.set(p.id as string, p);

    const optedOut = new Set(
      ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
        .filter((p) => !p.show_in_recommendations)
        .map((p) => p.user_id),
    );
    const blocked = new Set<string>();
    for (const b of ((blocksRes.data ?? []) as { blocker_id: string; blocked_id: string }[])) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }

    const friends = await friendIdSet(viewerId);
    const wantLoc = (opts.viewerLocation ?? "").trim().toLowerCase();
    const seenCreator = new Set<string>();
    const items: DiscoveryItem[] = [];
    for (const r of rows) {
      const prof = profById.get(r.publisher_id);
      if (!prof || !prof.handle) continue;
      // Per-viewer since 0082 — an admin-hidden creator drops out of discovery
      // for strangers, but a friend browsing still sees them.
      if (!isAccountVisibleTo(flagsOf(prof), relationTo(r.publisher_id, viewerId, friends))) continue;
      if (optedOut.has(r.publisher_id) || blocked.has(r.publisher_id)) continue;
      if (seenCreator.has(r.publisher_id)) continue; // one card per creator — variety
      seenCreator.add(r.publisher_id);
      const loc = ((prof.location as string) ?? "").trim().toLowerCase();
      items.push({
        id: r.id,
        title: r.title,
        mediaKind: r.media_kind,
        thumbnailUrl: r.thumbnail_url,
        mediaUrl: r.media_url,
        streamUid: r.stream_uid ?? null,
        handle: prof.handle as string,
        displayName: (prof.display_name as string) || `@${prof.handle as string}`,
        avatarUrl: (prof.avatar_url as string) ?? null,
        isVerified: (prof.is_verified as boolean) ?? false,
        nearby: !!wantLoc && loc === wantLoc,
      });
      if (items.length >= limit * 2) break;
    }

    // Location-first ordering when we know where the viewer is.
    const located = !!wantLoc;
    if (located) items.sort((a, b) => Number(b.nearby) - Number(a.nearby));

    return { items: items.slice(0, limit), located, nextOffset };
  } catch {
    return { items: [], located: false, nextOffset: null };
  }
}
