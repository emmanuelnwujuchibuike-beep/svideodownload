import { createAdminClient } from "@/lib/supabase/admin";

import type { Visibility } from "./profile";

/**
 * Collections data access — user-curated, privacy-scoped sets of posts. A
 * collection points at posts (never copies media). Every read honours the
 * collection's own visibility (public | followers | private), so the profile
 * Collections tab plugs into the same per-tab privacy model as Reposts/Liked/Saved.
 * All functions are BEST-EFFORT: before migration 0027 they return empty/false
 * instead of throwing, so the app runs fine and upgrades automatically after.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface CollectionCard {
  id: string;
  name: string;
  visibility: Visibility;
  count: number;
  coverUrl: string | null;
  updatedAt: string;
  isOwner: boolean;
}

/** Can a viewer see a collection of this visibility? (owner always; pure). */
export function canViewCollection(vis: Visibility, isOwner: boolean, isFollowing: boolean): boolean {
  if (isOwner) return true;
  if (vis === "public") return true;
  if (vis === "followers") return isFollowing;
  return false;
}

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  visibility: Visibility;
  updated_at: string;
}

/**
 * A profile's collections that `viewerId` is allowed to see, newest-updated first,
 * each with its item count + a cover thumbnail (most-recently-added item's image).
 */
export async function listViewableCollections(
  ownerId: string,
  viewerId: string | null,
  isFollowing: boolean,
): Promise<CollectionCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const isOwner = viewerId === ownerId;
    const { data } = await db
      .from("collections")
      .select("id, user_id, name, visibility, updated_at")
      .eq("user_id", ownerId)
      .order("updated_at", { ascending: false });
    const rows = ((data ?? []) as CollectionRow[]).filter((c) =>
      canViewCollection(c.visibility, isOwner, isFollowing),
    );
    if (rows.length === 0) return [];

    const ids = rows.map((c) => c.id);
    const { data: items } = await db
      .from("collection_items")
      .select("collection_id, post_id, added_at")
      .in("collection_id", ids)
      .order("added_at", { ascending: false });
    const itemRows = (items ?? []) as { collection_id: string; post_id: string }[];

    const count = new Map<string, number>();
    const coverPost = new Map<string, string>(); // first (newest) item per collection
    for (const it of itemRows) {
      count.set(it.collection_id, (count.get(it.collection_id) ?? 0) + 1);
      if (!coverPost.has(it.collection_id)) coverPost.set(it.collection_id, it.post_id);
    }

    const coverIds = [...new Set([...coverPost.values()])];
    const thumbById = new Map<string, string | null>();
    if (coverIds.length) {
      const { data: posts } = await db.from("posts").select("id, thumbnail_url").in("id", coverIds);
      for (const p of (posts ?? []) as { id: string; thumbnail_url: string | null }[]) {
        thumbById.set(p.id, p.thumbnail_url);
      }
    }

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      count: count.get(c.id) ?? 0,
      coverUrl: (coverPost.has(c.id) ? thumbById.get(coverPost.get(c.id)!) : null) ?? null,
      updatedAt: c.updated_at,
      isOwner,
    }));
  } catch {
    return [];
  }
}

/** How many collections `viewerId` can see on this profile — powers the tab gate.
 *  Lightweight (one query, no items/covers) since it runs on every profile load. */
export async function viewableCollectionsCount(
  ownerId: string,
  viewerId: string | null,
  isFollowing: boolean,
): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const db = createAdminClient();
    const isOwner = viewerId === ownerId;
    const { data } = await db.from("collections").select("visibility").eq("user_id", ownerId);
    return ((data ?? []) as { visibility: Visibility }[]).filter((c) =>
      canViewCollection(c.visibility, isOwner, isFollowing),
    ).length;
  } catch {
    return 0;
  }
}

/** The viewer's own collections + whether each already contains `postId` (picker). */
export async function myCollectionsWithMembership(
  userId: string,
  postId: string,
): Promise<{ id: string; name: string; visibility: Visibility; count: number; contains: boolean }[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("collections")
      .select("id, name, visibility, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    const rows = (data ?? []) as { id: string; name: string; visibility: Visibility }[];
    if (rows.length === 0) return [];
    const ids = rows.map((c) => c.id);
    const { data: items } = await db
      .from("collection_items")
      .select("collection_id, post_id")
      .in("collection_id", ids);
    const itemRows = (items ?? []) as { collection_id: string; post_id: string }[];
    const count = new Map<string, number>();
    const contains = new Set<string>();
    for (const it of itemRows) {
      count.set(it.collection_id, (count.get(it.collection_id) ?? 0) + 1);
      if (it.post_id === postId) contains.add(it.collection_id);
    }
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      count: count.get(c.id) ?? 0,
      contains: contains.has(c.id),
    }));
  } catch {
    return [];
  }
}

/** Fetch a single collection's meta if `viewerId` may see it (else null). */
export async function getCollectionMeta(
  collectionId: string,
  viewerId: string | null,
): Promise<{ id: string; name: string; visibility: Visibility; ownerId: string; isOwner: boolean } | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("collections")
      .select("id, user_id, name, visibility")
      .eq("id", collectionId)
      .maybeSingle();
    const c = data as { id: string; user_id: string; name: string; visibility: Visibility } | null;
    if (!c) return null;
    const isOwner = viewerId === c.user_id;
    let isFollowing = false;
    if (!isOwner && viewerId && c.visibility === "followers") {
      const { count } = await db
        .from("follows")
        .select("follower_id", { head: true, count: "exact" })
        .eq("follower_id", viewerId)
        .eq("following_id", c.user_id);
      isFollowing = (count ?? 0) > 0;
    }
    if (!canViewCollection(c.visibility, isOwner, isFollowing)) return null;
    return { id: c.id, name: c.name, visibility: c.visibility, ownerId: c.user_id, isOwner };
  } catch {
    return null;
  }
}

/** Assert the viewer owns a collection (for writes). */
export async function ownsCollection(collectionId: string, userId: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const db = createAdminClient();
    const { data } = await db.from("collections").select("user_id").eq("id", collectionId).maybeSingle();
    return (data as { user_id: string } | null)?.user_id === userId;
  } catch {
    return false;
  }
}
