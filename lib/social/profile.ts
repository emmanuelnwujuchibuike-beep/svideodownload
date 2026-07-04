import { getCached } from "@/lib/cache";
import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Social profile data layer. Reads use the service-role client and apply
 * visibility/blocks in code so callers can distinguish "private" (show a gated
 * state) from "not found" (404). Privacy ALWAYS overrides — a restricted viewer
 * never receives bio/links/counts beyond the minimal card.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type Visibility = "public" | "followers" | "private";

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  website: string | null;
  visibility: Visibility;
  isVerified: boolean;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  /** True when the viewer can only see the minimal card (private/followers). */
  restricted: boolean;
  /** The viewer's relationship to this profile. */
  isOwner: boolean;
  isFollowing: boolean;
  /** True when the VIEWER has blocked this profile. */
  viewerHasBlocked: boolean;
}

/* ------------------------------- handles -------------------------------- */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

const RESERVED = new Set([
  "admin", "api", "account", "login", "logout", "settings", "pricing", "blog",
  "developers", "contact", "about", "terms", "privacy", "dmca", "u", "go",
  "auth", "frenzsave", "support", "help", "home", "explore", "trending",
]);

/** Normalises a raw handle and validates it. Returns null if invalid/reserved. */
export function normalizeHandle(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^@/, "");
  if (!HANDLE_RE.test(h) || RESERVED.has(h)) return null;
  return h;
}

/* -------------------------------- reads --------------------------------- */

interface ProfileRow {
  id: string;
  email: string | null;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  website: string | null;
  visibility: Visibility;
  is_verified: boolean;
  is_suspended: boolean;
  followers_count: number;
  following_count: number;
  created_at: string;
}

const SELECT =
  "id, email, handle, display_name, bio, avatar_url, banner_url, website, visibility, is_verified, is_suspended, followers_count, following_count, created_at";

function fallbackName(row: ProfileRow): string {
  return row.display_name || (row.handle ? `@${row.handle}` : "Member");
}

async function relationship(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string | null,
  targetId: string,
): Promise<{ isFollowing: boolean; blockedByTarget: boolean; viewerHasBlocked: boolean }> {
  if (!viewerId) return { isFollowing: false, blockedByTarget: false, viewerHasBlocked: false };
  const [follow, blockedBy, blocked] = await Promise.all([
    db.from("follows").select("follower_id", { head: true, count: "exact" })
      .eq("follower_id", viewerId).eq("following_id", targetId),
    db.from("blocks").select("blocker_id", { head: true, count: "exact" })
      .eq("blocker_id", targetId).eq("blocked_id", viewerId),
    db.from("blocks").select("blocker_id", { head: true, count: "exact" })
      .eq("blocker_id", viewerId).eq("blocked_id", targetId),
  ]);
  return {
    isFollowing: (follow.count ?? 0) > 0,
    blockedByTarget: (blockedBy.count ?? 0) > 0,
    viewerHasBlocked: (blocked.count ?? 0) > 0,
  };
}

/** Public profile by handle, with privacy applied for `viewerId` (null = anon). */
export async function getPublicProfile(
  handle: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  if (!hasSupabase) return null;
  const norm = handle.trim().toLowerCase().replace(/^@/, "");
  if (!HANDLE_RE.test(norm)) return null;
  // Cached 30s per (handle, viewer) via Upstash — the profile is the most-viewed
  // page after home, so this cuts a lot of repeat DB reads. Failures throw (below)
  // so a blip is never cached; the caller degrades to notFound for that render.
  try {
    return await getCached(`pubprofile:${norm}:${viewerId ?? "anon"}`, 30, () => loadPublicProfile(norm, viewerId));
  } catch {
    return null;
  }
}

async function loadPublicProfile(norm: string, viewerId: string | null): Promise<PublicProfile | null> {
  const db = createAdminClient();
  // Handles are stored lowercased, so match exactly — NOT with ilike, whose
  // `_`/`%` would be treated as wildcards (handles allow underscores).
  const { data, error } = await db
    .from("profiles")
    .select(SELECT)
    .eq("handle", norm)
    .maybeSingle();
  if (error) throw error; // don't cache a DB failure as "not found"
  const row = data as ProfileRow | null;
  if (!row || row.is_suspended) return null;

  const isOwner = viewerId === row.id;
  const { isFollowing, blockedByTarget, viewerHasBlocked } = isOwner
    ? { isFollowing: false, blockedByTarget: false, viewerHasBlocked: false }
    : await relationship(db, viewerId, row.id);

  // A block by the target hides the profile entirely (treat as not found).
  if (blockedByTarget) return null;

  const restricted =
    !isOwner &&
    (row.visibility === "private" ||
      (row.visibility === "followers" && !isFollowing));

  return {
    id: row.id,
    handle: row.handle ?? "",
    displayName: fallbackName(row),
    bio: restricted ? null : row.bio,
    avatarUrl: row.avatar_url,
    bannerUrl: restricted ? null : row.banner_url,
    website: restricted ? null : row.website,
    visibility: row.visibility,
    isVerified: row.is_verified,
    followersCount: restricted ? 0 : row.followers_count,
    followingCount: restricted ? 0 : row.following_count,
    createdAt: row.created_at,
    restricted,
    isOwner,
    isFollowing,
    viewerHasBlocked,
  };
}

export interface OwnProfile {
  id: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  website: string | null;
  visibility: Visibility;
}

/** The signed-in user's own editable profile fields. */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("profiles").select(SELECT).eq("id", userId).maybeSingle();
    const row = data as ProfileRow | null;
    if (!row) return null;
    return {
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      website: row.website,
      visibility: row.visibility,
    };
  } catch {
    return null;
  }
}

export interface PrivacySettings {
  activity_visibility: Visibility;
  followers_visibility: Visibility;
  comments_policy: "everyone" | "followers" | "off";
  messages_policy: "everyone" | "followers" | "off";
  allow_indexing: boolean;
  show_in_recommendations: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  activity_visibility: "public",
  followers_visibility: "public",
  comments_policy: "everyone",
  messages_policy: "followers",
  allow_indexing: true,
  show_in_recommendations: true,
};

/* ----------------------------- follow lists ----------------------------- */

export interface ListUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  plan: BillingPlan;
  viewerFollows: boolean;
}

/** Batched plan lookup (one query) → id → effective plan. */
async function plansFor(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, BillingPlan>> {
  const map = new Map<string, BillingPlan>();
  if (ids.length === 0) return map;
  const { data } = await db
    .from("subscriptions")
    .select("user_id, plan, status")
    .in("user_id", ids)
    .in("status", ["active", "trialing"]);
  for (const r of (data ?? []) as { user_id: string; plan: BillingPlan }[]) {
    map.set(r.user_id, r.plan);
  }
  return map;
}

/** Can `viewerId` see `targetId`'s follower/following lists? */
async function canViewFollows(
  db: ReturnType<typeof createAdminClient>,
  targetId: string,
  viewerId: string | null,
): Promise<boolean> {
  if (viewerId === targetId) return true;
  const { followers_visibility } = await getPrivacySettings(targetId);
  if (followers_visibility === "public") return true;
  if (!viewerId) return false;
  if (followers_visibility === "private") return false;
  // followers-only → viewer must follow the target.
  const { count } = await db
    .from("follows")
    .select("follower_id", { head: true, count: "exact" })
    .eq("follower_id", viewerId)
    .eq("following_id", targetId);
  return (count ?? 0) > 0;
}

async function buildList(
  db: ReturnType<typeof createAdminClient>,
  profileIds: string[],
  viewerId: string | null,
): Promise<ListUser[]> {
  if (profileIds.length === 0) return [];
  const { data: profs } = await db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, bio, is_verified, is_suspended")
    .in("id", profileIds);
  const rows = ((profs ?? []) as ProfileRow[]).filter((p) => !p.is_suspended && p.handle);

  const ids = rows.map((r) => r.id);
  const [plans, follows] = await Promise.all([
    plansFor(db, ids),
    viewerId
      ? db.from("follows").select("following_id").eq("follower_id", viewerId).in("following_id", ids)
      : Promise.resolve({ data: [] as { following_id: string }[] }),
  ]);
  const viewerFollowing = new Set(
    ((follows.data ?? []) as { following_id: string }[]).map((f) => f.following_id),
  );

  // Preserve the incoming order (recency from the follows query).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return profileIds
    .map((id) => byId.get(id))
    .filter((r): r is ProfileRow => !!r)
    .map((r) => ({
      id: r.id,
      handle: r.handle ?? "",
      displayName: fallbackName(r),
      avatarUrl: r.avatar_url,
      bio: r.bio,
      isVerified: r.is_verified,
      plan: plans.get(r.id) ?? "free",
      viewerFollows: viewerFollowing.has(r.id),
    }));
}

/** Followers of `targetId`, privacy-gated. Null = not permitted to view. */
export async function listFollowers(
  targetId: string,
  viewerId: string | null,
  limit = 50,
): Promise<ListUser[] | null> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    if (!(await canViewFollows(db, targetId, viewerId))) return null;
    const { data } = await db
      .from("follows")
      .select("follower_id")
      .eq("following_id", targetId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return buildList(db, ((data ?? []) as { follower_id: string }[]).map((r) => r.follower_id), viewerId);
  } catch {
    return [];
  }
}

/** Accounts `targetId` follows, privacy-gated. Null = not permitted to view. */
export async function listFollowing(
  targetId: string,
  viewerId: string | null,
  limit = 50,
): Promise<ListUser[] | null> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    if (!(await canViewFollows(db, targetId, viewerId))) return null;
    const { data } = await db
      .from("follows")
      .select("following_id")
      .eq("follower_id", targetId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return buildList(db, ((data ?? []) as { following_id: string }[]).map((r) => r.following_id), viewerId);
  } catch {
    return [];
  }
}

/** The viewer's own blocked users (for the block-management UI). */
export async function listBlocked(viewerId: string): Promise<ListUser[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(100);
    return buildList(db, ((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id), viewerId);
  } catch {
    return [];
  }
}

/** A user's privacy settings (defaults if none saved yet). */
export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
  if (!hasSupabase) return DEFAULT_PRIVACY;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("privacy_settings")
      .select(
        "activity_visibility, followers_visibility, comments_policy, messages_policy, allow_indexing, show_in_recommendations",
      )
      .eq("user_id", userId)
      .maybeSingle();
    return { ...DEFAULT_PRIVACY, ...((data ?? {}) as Partial<PrivacySettings>) };
  } catch {
    return DEFAULT_PRIVACY;
  }
}
