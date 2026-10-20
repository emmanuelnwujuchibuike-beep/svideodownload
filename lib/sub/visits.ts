import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile visits and exclusive-post views (0265), for Earnings & analytics (step 21, owner 2026-10-19).
 *
 * Writes are fire-and-forget and fail open: a missed count must never slow or break a profile or a post.
 * Each row is deduplicated by its key (one per visitor per day), so a refresh does not count twice.
 * Reads are the creator's own figures, by the server only (the tables have no policies — 0265).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * A guest's visitor key: a one-way hash of their network address and browser, salted with the day — so it
 * can't be reversed into an address, and a person can't be followed from one day to the next.
 */
export function guestVisitorKey(ip: string | null, userAgent: string | null, day = today()): string | null {
  if (!ip) return null;
  return `g:${createHash("sha256").update(`${day}|${ip}|${userAgent ?? ""}`).digest("hex").slice(0, 32)}`;
}

/** Count one visit to a profile. The owner's own visits are not counted. */
export async function recordProfileVisit(profileId: string, viewerId: string | null, guestKey: string | null): Promise<void> {
  try {
    if (!UUID.test(profileId) || viewerId === profileId) return;
    const visitorKey = viewerId && UUID.test(viewerId) ? `u:${viewerId}` : guestKey;
    if (!visitorKey) return;
    await createAdminClient().from("profile_visits").upsert({ profile_id: profileId, visitor_key: visitorKey, day: today() }, { onConflict: "profile_id,visitor_key,day", ignoreDuplicates: true });
  } catch {
    /* fail open: a count, never a reason for the page to wait or fail */
  }
}

/** Count one view of an exclusive post by someone with access. The creator's own opens are not counted. */
export async function recordSubPostView(postId: string, creatorId: string, viewerId: string): Promise<void> {
  try {
    if (!UUID.test(postId) || !UUID.test(creatorId) || !UUID.test(viewerId) || viewerId === creatorId) return;
    await createAdminClient().from("sub_post_views").upsert({ post_id: postId, creator_id: creatorId, viewer_id: viewerId, day: today() }, { onConflict: "post_id,viewer_id,day", ignoreDuplicates: true });
  } catch {
    /* fail open */
  }
}

/** Visits to the creator's profile since `since` (a date). Null when it can't be read (0265 not applied): the page shows "—". */
export async function profileVisitsSince(profileId: string, since: string): Promise<number | null> {
  const { count, error } = await createAdminClient().from("profile_visits").select("profile_id", { count: "exact", head: true }).eq("profile_id", profileId).gte("day", since.slice(0, 10));
  return error ? null : (count ?? 0);
}

export interface TopSubPost {
  id: string;
  rank: number;
  kind: "video" | "photo";
  postedAt: string;
  views: number;
  /** the tiny blurred preview (0263) — the creator's own post, no signed link needed for a thumbnail */
  thumb: string | null;
}

/** The creator's most-viewed exclusive posts in the period. Null when the views can't be read. */
export async function topSubPostsSince(creatorId: string, since: string, limit = 3): Promise<TopSubPost[] | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("sub_post_views").select("post_id").eq("creator_id", creatorId).gte("day", since.slice(0, 10)).limit(20000);
  if (error) return null;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { post_id: string }[]) counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!ranked.length) return [];
  const ids = ranked.map(([id]) => id);
  const [postsR, mediaR] = await Promise.all([
    db.from("sub_posts").select("id, created_at, blur_preview").in("id", ids),
    db.from("sub_post_media").select("post_id, media_kind, idx").in("post_id", ids).order("idx", { ascending: true }),
  ]);
  const posts = new Map(((postsR.data ?? []) as { id: string; created_at: string; blur_preview?: string | null }[]).map((p) => [p.id, p]));
  const firstKind = new Map<string, string>();
  for (const m of (mediaR.data ?? []) as { post_id: string; media_kind: string }[]) if (!firstKind.has(m.post_id)) firstKind.set(m.post_id, m.media_kind);
  return ranked
    .filter(([id]) => posts.has(id))
    .map(([id, views], i) => ({ id, rank: i + 1, kind: firstKind.get(id) === "video" ? "video" : "photo", postedAt: posts.get(id)!.created_at, views, thumb: posts.get(id)!.blur_preview ?? null }));
}
