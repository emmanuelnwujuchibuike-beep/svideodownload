import type { User } from "@supabase/supabase-js";

import { effectiveModules } from "@/lib/profile/engine";
import { computeProfileHealth, type HealthSignals, type ProfileHealth } from "@/lib/profile/health";
import { profileType } from "@/lib/profile/profile-types";
import { viewableCollectionsCount } from "@/lib/social/collections";
import { friendsCount } from "@/lib/social/friends";
import { DEFAULT_PRIVACY, getOwnProfile, getPrivacySettings } from "@/lib/social/profile";
import {
  getProfileDetails,
  getProfileIdentity,
  getProfileModules,
  listCredentials,
  listOfferings,
} from "@/lib/social/profile-platform";
import { computeReputation } from "@/lib/social/reputation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile Intelligence™ — gathering the signals (Feature 18 · Part 15).
 *
 * Every read is FAIL-CLOSED and INDEPENDENT, the pattern the profile has used
 * since `getProfileExtras`. That matters more here than anywhere else: the
 * health score reads across identity, security, privacy, content, community and
 * standing, so it touches the most tables of any single view. One missing table
 * — or a migration an operator hasn't applied — must degrade that pillar, not
 * take the page down.
 *
 * A signal that cannot be read is treated as NOT SET, never as satisfied. So an
 * unreadable security table lowers the security pillar and produces advice to
 * check it, rather than quietly reporting the account as protected. Failing
 * towards "you might be exposed" is the only safe direction for a security score.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Rows a member owns in a table, or 0 if it can't be read. */
async function countRows(table: string, column: string, userId: string): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const { count, error } = await createAdminClient()
      .from(table)
      .select(column, { head: true, count: "exact" })
      .eq(column, userId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Has this member ever saved their own privacy settings, or are they on the
 *  defaults? A row's existence is the signal — not its contents. */
async function privacyReviewed(userId: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const { count, error } = await createAdminClient()
      .from("privacy_settings")
      .select("user_id", { head: true, count: "exact" })
      .eq("user_id", userId);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Published post count for the member's own profile. */
async function postCount(userId: string): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const { count, error } = await createAdminClient()
      .from("posts")
      .select("id", { head: true, count: "exact" })
      .eq("publisher_id", userId)
      .eq("status", "published");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Follower / following / suspension straight off the profile row. */
async function profileCounts(
  userId: string,
): Promise<{ followers: number; following: number; suspended: boolean; verified: boolean; createdAt: string | null }> {
  const fallback = { followers: 0, following: 0, suspended: false, verified: false, createdAt: null };
  if (!hasSupabase) return fallback;
  try {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("followers_count, following_count, is_suspended, is_verified, created_at")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return fallback;
    const r = data as {
      followers_count: number | null;
      following_count: number | null;
      is_suspended: boolean | null;
      is_verified: boolean | null;
      created_at: string | null;
    };
    return {
      followers: r.followers_count ?? 0,
      following: r.following_count ?? 0,
      suspended: r.is_suspended === true,
      verified: r.is_verified === true,
      createdAt: r.created_at,
    };
  } catch {
    return fallback;
  }
}

/**
 * The member's whole health picture.
 *
 * `user` comes from the caller's own session (`supabase.auth.getUser()`), which
 * is where the email-confirmation and MFA-factor state live — those are auth
 * facts, not table rows, and must come from the session rather than be inferred.
 */
export async function getProfileHealth(user: User): Promise<ProfileHealth> {
  const userId = user.id;

  const [
    own,
    privacy,
    reviewed,
    identity,
    storedModules,
    details,
    credentials,
    offerings,
    posts,
    counts,
    friends,
    collections,
    passkeys,
    pins,
    recoveryCodes,
    blocks,
    mutes,
  ] = await Promise.all([
    getOwnProfile(userId),
    getPrivacySettings(userId),
    privacyReviewed(userId),
    getProfileIdentity(userId),
    getProfileModules(userId),
    getProfileDetails(userId),
    listCredentials(userId),
    listOfferings(userId),
    postCount(userId),
    profileCounts(userId),
    friendsCount(userId).catch(() => 0),
    viewableCollectionsCount(userId, userId, false).catch(() => 0),
    countRows("webauthn_credentials", "user_id", userId),
    countRows("security_pin", "user_id", userId),
    countRows("mfa_recovery_codes", "user_id", userId),
    countRows("blocks", "blocker_id", userId),
    countRows("muted_creators", "muter_id", userId),
  ]);

  // How many of the member's enabled Part-14 sections actually hold something.
  // This is the "your profile has substance" signal, and it reuses the engine's
  // own notion of what is enabled rather than a second, drifting definition.
  const enabled = effectiveModules(identity.type, storedModules).filter((m) => m.enabled);
  const filled = enabled.filter((m) => {
    switch (m.key) {
      case "about":
        return !!details.headline || !!details.mission || !!own?.bio;
      case "posts":
      case "reels":
        return posts > 0;
      case "collections":
        return collections > 0;
      case "skills":
        return details.skills.length > 0;
      case "resume":
        return !!details.resumeUrl;
      case "hours":
        return details.hours.some((h) => !h.closed) || !!details.address;
      case "catalog":
        return offerings.some((o) => o.kind === "product");
      case "services":
        return offerings.some((o) => o.kind === "service");
      case "portfolio":
        return credentials.some((c) => c.kind === "project");
      case "experience":
        return credentials.some((c) => c.kind === "experience");
      case "education":
        return credentials.some((c) => c.kind === "education");
      case "certifications":
        return credentials.some((c) => c.kind === "certification");
      case "awards":
        return credentials.some((c) => c.kind === "award");
      case "publications":
        return credentials.some((c) => c.kind === "publication");
      default:
        return false;
    }
  }).length;

  const createdAt = counts.createdAt ?? user.created_at ?? new Date().toISOString();
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));

  // Trust index comes from the SAME reputation engine the profile already
  // shows, so the two can never disagree about how established an account is.
  const { trustIndex } = computeReputation({
    accountAgeDays,
    posts,
    followers: counts.followers,
    friends,
    engagementReceived: 0,
    views: 0,
    collections,
    verified: counts.verified,
    bonus: 0,
  });

  // MFA comes from the session's verified factors — an unverified enrolment is
  // not protection, so `verified` is the only status that counts.
  const factors = (user.factors ?? []) as { status?: string }[];
  const mfaEnabled = factors.some((f) => f.status === "verified");

  // "Scoped" = they have moved at least one activity tab off the wide-open
  // default. Compared against the shipped defaults rather than hard-coded, so
  // changing a default can never silently change what this measures.
  const activityScoped =
    privacy.activity_visibility !== DEFAULT_PRIVACY.activity_visibility ||
    privacy.followers_visibility !== DEFAULT_PRIVACY.followers_visibility ||
    privacy.reposts_visibility !== DEFAULT_PRIVACY.reposts_visibility;

  const signals: HealthSignals = {
    hasHandle: !!own?.handle,
    hasDisplayName: !!own?.displayName,
    hasAvatar: !!own?.avatarUrl,
    hasBio: !!own?.bio,
    hasBanner: !!own?.bannerUrl,
    hasLinks: !!own?.website,
    profileTypeDeclared: identity.type !== profileType(null).key,
    hasHeadline: !!details.headline,

    emailConfirmed: !!user.email_confirmed_at,
    mfaEnabled,
    passkeyCount: passkeys,
    hasRecoveryCodes: recoveryCodes > 0,
    hasPin: pins > 0,

    privacyReviewed: reviewed,
    activityScoped,
    blockedOrMutedAnyone: blocks + mutes > 0,

    posts,
    collections,
    filledModules: filled,

    friends,
    following: counts.following,

    verified: counts.verified,
    trustIndex,
    accountAgeDays,
    suspended: counts.suspended,
  };

  return computeProfileHealth(signals);
}
