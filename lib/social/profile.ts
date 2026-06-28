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
): Promise<{ isFollowing: boolean; blockedByTarget: boolean }> {
  if (!viewerId) return { isFollowing: false, blockedByTarget: false };
  const [follow, block] = await Promise.all([
    db.from("follows").select("follower_id", { head: true, count: "exact" })
      .eq("follower_id", viewerId).eq("following_id", targetId),
    db.from("blocks").select("blocker_id", { head: true, count: "exact" })
      .eq("blocker_id", targetId).eq("blocked_id", viewerId),
  ]);
  return {
    isFollowing: (follow.count ?? 0) > 0,
    blockedByTarget: (block.count ?? 0) > 0,
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
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("profiles")
      .select(SELECT)
      .ilike("handle", norm)
      .maybeSingle();
    const row = data as ProfileRow | null;
    if (!row || row.is_suspended) return null;

    const isOwner = viewerId === row.id;
    const { isFollowing, blockedByTarget } = isOwner
      ? { isFollowing: false, blockedByTarget: false }
      : await relationship(db, viewerId, row.id);

    // A block hides the profile entirely (treat as not found for the viewer).
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
    };
  } catch {
    return null;
  }
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
