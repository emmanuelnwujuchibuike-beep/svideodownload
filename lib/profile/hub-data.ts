import "server-only";

import type { ActivityRow } from "@/features/profile/activity-map";
import { notificationsToActivity } from "@/features/profile/activity-map";
import type { TopContent } from "@/features/profile/identity-analytics";
import { resolveViewerRole } from "@/lib/profile/audience";
import { resolveProfileLayout } from "@/lib/profile/engine";
import type { ProfileHealth } from "@/lib/profile/health";
import { HUB_ENGINE_KEYS, isHubOwnerKey, type HubEngineKey, type HubKey } from "@/lib/profile/hub";
import { engineSubstance } from "@/lib/profile/hub-substance";
import type { ModuleKey } from "@/lib/profile/modules";
import { computeAchievements, earnedCount, type EarnedAchievement } from "@/lib/social/achievements";
import { viewableCollectionsCount } from "@/lib/social/collections";
import { friendIdSet } from "@/lib/social/friend-ids";
import { friendsCount, friendshipState } from "@/lib/social/friends";
import { viewerCircleIds } from "@/lib/social/graph/store";
import { getJournalEntries, type JournalEntry } from "@/lib/social/journal";
import { buildLifeJourney, type JourneyEntry } from "@/lib/social/life-journey";
import { listNotifications } from "@/lib/social/notifications";
import { getProfileHealth } from "@/lib/social/profile-health";
import { getPublicProfile, getReputationBonus, type PublicProfile } from "@/lib/social/profile";
import {
  credentialsByKind,
  getProfileDetails,
  getProfileIdentity,
  getProfileModules,
  listCredentials,
  listOfferings,
  type Credential,
  type Offering,
  type ProfileDetails,
} from "@/lib/social/profile-platform";
import { computeReputation, type Reputation } from "@/lib/social/reputation";
import { getTimeCapsules, type TimeCapsule } from "@/lib/social/time-capsules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HUB DATA — one section, read when it is about to be looked at
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "The profile page should be extremely light." Before
 * this, the owner's profile awaited SIX more reads after the hero — top
 * friends, twelve notifications, the first post, the time capsules, the
 * journal, the health score — and streamed every one of them into the
 * document as a card, under the grid, for a page most people open to look
 * at the grid. Every read here happens instead when a button on the hub
 * scrolls into view or is tapped, one section per request, and the answer
 * is small enough to keep on the device.
 *
 * ── 🔴 THE SAME GATES, RE-CHECKED ON EVERY READ ─────────────────────────────
 *
 * The page never decides what a section may contain; this does, per request,
 * from the real relationship between the viewer and the profile:
 *
 *   · an owner key (streak, health, journal…) answers ONLY the owner —
 *     `getPublicProfile(handle, viewerId).isOwner`, never a flag from the
 *     client;
 *   · an engine key runs the SAME `resolveProfileLayout` the page runs, with
 *     the same audience, circle and substance gates, and refuses when the
 *     module is not in the resolved layout for this viewer. A key the
 *     catalogue does not name is a 404 before anything is read.
 *
 * Every helper here degrades to empty rather than throwing, as the page's
 * did; a section that cannot be read is an empty section, not a 500.
 */

export type HubPayload =
  | { key: "about"; details: ProfileDetails; handle: string; isOwner: boolean }
  | { key: "achievements"; achievements: EarnedAchievement[] }
  | { key: "portfolio" | "experience" | "education" | "certifications" | "awards" | "publications"; items: Credential[]; isOwner: boolean }
  | { key: "skills"; skills: string[]; isOwner: boolean }
  | { key: "resume"; url: string | null; isOwner: boolean }
  | { key: "catalog" | "services"; items: Offering[]; isOwner: boolean }
  | { key: "hours"; details: ProfileDetails; isOwner: boolean }
  | { key: "streak" }
  | { key: "reputation"; reputation: Reputation }
  | { key: "health"; health: ProfileHealth | null }
  | { key: "analytics"; data: { views: number; likes: number; comments: number; shares: number; saves: number }; topContent: TopContent | null }
  | { key: "journey"; entries: JourneyEntry[] }
  | { key: "capsules"; capsules: TimeCapsule[] }
  | { key: "journal"; entries: JournalEntry[] }
  | { key: "friends"; friends: { name: string; handle: string; avatarUrl: string | null }[] }
  | { key: "activity"; rows: ActivityRow[] }
  | { key: "tools" }
  | { key: "appearance" };

export type HubRead = { ok: true; payload: HubPayload } | { ok: false; status: 401 | 403 | 404 };

const CREDENTIAL_KIND: Record<string, Credential["kind"]> = {
  portfolio: "project",
  experience: "experience",
  education: "education",
  certifications: "certification",
  awards: "award",
  publications: "publication",
};

export async function readHubSection(handle: string, key: HubKey, viewerId: string | null): Promise<HubRead> {
  const profile = await getPublicProfile(handle, viewerId);
  if (!profile) return { ok: false, status: 404 };

  if (isHubOwnerKey(key)) {
    if (!viewerId) return { ok: false, status: 401 };
    if (!profile.isOwner) return { ok: false, status: 403 };
    return { ok: true, payload: await ownerSection(profile, key) };
  }
  // A restricted (private) profile shows a visitor nothing below the hero.
  if (profile.restricted && !profile.isOwner) return { ok: false, status: 403 };
  return engineSection(profile, key, viewerId);
}

/* ───────────────────────────── engine keys ───────────────────────────────── */

async function engineSection(profile: PublicProfile, key: HubEngineKey, viewerId: string | null): Promise<HubRead> {
  const isViewer = !!viewerId && !profile.isOwner;
  const [identity, stored, details, credentials, offerings, friendState, viewerCircles] = await Promise.all([
    getProfileIdentity(profile.id),
    getProfileModules(profile.id),
    getProfileDetails(profile.id),
    listCredentials(profile.id),
    listOfferings(profile.id),
    isViewer ? friendshipState(viewerId!, profile.id) : Promise.resolve("none" as const),
    viewerCircleIds(profile.id, viewerId),
  ]);
  const role = resolveViewerRole({
    viewerId,
    isOwner: profile.isOwner,
    isAdmin: false,
    isFriend: friendState === "friends",
    isFollowing: profile.isFollowing,
  });
  const byKind = credentialsByKind(credentials);
  const products = offerings.filter((o) => o.kind === "product");
  const services = offerings.filter((o) => o.kind === "service");

  /*
    Substance, for THIS key only — the other keys are assumed present so the
    resolver's answer about this one is exactly the page's. `achievements`
    needs the reputation inputs, which are read only when asked for.
  */
  const achievements = key === "achievements" ? await achievementsFor(profile) : null;
  const substance: Partial<Record<ModuleKey, boolean>> = {};
  for (const k of HUB_ENGINE_KEYS) substance[k] = true;
  for (const k of ["posts", "reels", "downloads", "collections", "reposted", "liked", "saved"] as const) substance[k] = true;
  substance[key] = engineSubstance(key, { details, byKind, products, services, achievements, website: profile.website });

  const layout = resolveProfileLayout({
    type: identity.type,
    stored,
    landing: identity.landingModule,
    role,
    content: substance,
    allowedGoverned: [],
    viewerCircles,
  });
  if (!layout.modules.some((m) => m.key === key)) return { ok: false, status: profile.isOwner ? 404 : 403 };

  const isOwner = profile.isOwner;
  switch (key) {
    case "about":
      return { ok: true, payload: { key, details, handle: profile.handle, isOwner } };
    case "achievements":
      return { ok: true, payload: { key, achievements: achievements ?? [] } };
    case "portfolio":
    case "experience":
    case "education":
    case "certifications":
    case "awards":
    case "publications":
      return { ok: true, payload: { key, items: byKind[CREDENTIAL_KIND[key]!] ?? [], isOwner } };
    case "skills":
      return { ok: true, payload: { key, skills: details.skills, isOwner } };
    case "resume":
      return { ok: true, payload: { key, url: details.resumeUrl, isOwner } };
    case "catalog":
      return { ok: true, payload: { key, items: products, isOwner } };
    case "services":
      return { ok: true, payload: { key, items: services, isOwner } };
    case "hours":
      return { ok: true, payload: { key, details, isOwner } };
  }
}

/* ───────────────────────────── owner keys ────────────────────────────────── */

async function ownerSection(profile: PublicProfile, key: Exclude<HubKey, HubEngineKey>): Promise<HubPayload> {
  switch (key) {
    case "streak":
    case "tools":
    case "appearance":
      return { key };
    case "reputation":
      return { key, reputation: (await standing(profile)).reputation };
    case "health":
      return { key, health: (await ownerHealth()) ?? null };
    case "analytics": {
      const totals = await creatorTotals(profile.id);
      return {
        key,
        data: { views: totals.views, likes: totals.likes, comments: totals.comments, shares: totals.shares, saves: totals.saves },
        topContent: totals.topPost,
      };
    }
    case "journey": {
      const [s, firstPost] = await Promise.all([standing(profile), firstPublishedPost(profile.id)]);
      return {
        key,
        entries: buildLifeJourney({
          joinedAt: profile.createdAt,
          firstPost,
          rankName: s.reputation.rank.name,
          achievementsEarned: earnedCount(s.achievements),
          postsCount: s.postsTotal,
          friendsCount: s.friendTotal,
        }),
      };
    }
    case "capsules":
      return { key, capsules: await getTimeCapsules(profile.id) };
    case "journal":
      return { key, entries: await getJournalEntries(profile.id) };
    case "friends":
      return { key, friends: await topFriends(profile.id) };
    case "activity": {
      const notifs = await listNotifications(profile.id, 12);
      return { key, rows: notificationsToActivity(notifs.items) };
    }
  }
}

/* ───────────────────────────── the shared sums ───────────────────────────── */

/** Reputation and achievements are derived from the same real signals. Read once per request. */
async function standing(profile: PublicProfile) {
  const [postsTotal, friendTotal, collections, totals, bonus] = await Promise.all([
    publishedPostsCount(profile.id, profile.isOwner),
    friendsCount(profile.id),
    viewableCollectionsCount(profile.id, profile.isOwner ? profile.id : null, profile.isFollowing),
    creatorTotals(profile.id),
    getReputationBonus(profile.id),
  ]);
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86_400_000));
  const reputation = computeReputation({
    accountAgeDays,
    posts: postsTotal,
    followers: profile.followersCount,
    friends: friendTotal,
    engagementReceived: totals.likes + totals.comments + totals.shares + totals.saves,
    views: totals.views,
    collections,
    verified: profile.isVerified,
    bonus,
  });
  const achievements = computeAchievements({
    accountAgeDays,
    posts: postsTotal,
    followers: profile.followersCount,
    friends: friendTotal,
    likes: totals.likes,
    views: totals.views,
    collections,
    verified: profile.isVerified,
    reputationScore: reputation.score,
  });
  return { postsTotal, friendTotal, collections, totals, reputation, achievements };
}

async function achievementsFor(profile: PublicProfile): Promise<EarnedAchievement[]> {
  return (await standing(profile)).achievements;
}

/* ───────────────────────────── the readers ───────────────────────────────── */
/* Moved here from app/u/[handle]/page.tsx (2026-09-13) so the page and the
   API read the same way; the page keeps using the ones its hero needs. */

export async function ownerHealth(): Promise<ProfileHealth | undefined> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return undefined;
    return await getProfileHealth(user);
  } catch {
    return undefined;
  }
}

export async function publishedPostsCount(profileId: string, isOwner: boolean): Promise<number> {
  try {
    let q = createAdminClient().from("posts").select("id", { head: true, count: "exact" }).eq("publisher_id", profileId).eq("status", "published");
    if (!isOwner) q = q.eq("visibility", "public");
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function firstPublishedPost(
  profileId: string,
): Promise<{ id: string; title: string | null; thumbnailUrl: string | null; createdAt: string } | null> {
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, media_url, created_at")
      .eq("publisher_id", profileId)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; title: string | null; thumbnail_url: string | null; media_url: string | null; created_at: string };
    return { id: row.id, title: row.title, thumbnailUrl: row.thumbnail_url ?? row.media_url, createdAt: row.created_at };
  } catch {
    return null;
  }
}

export async function creatorTotals(profileId: string): Promise<{
  likes: number;
  views: number;
  comments: number;
  shares: number;
  saves: number;
  topPost: TopContent | null;
}> {
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, media_url, likes_count, views_count, comments_count, shares_count, saves_count")
      .eq("publisher_id", profileId)
      .eq("status", "published");
    let likes = 0;
    let views = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;
    let topPost: TopContent | null = null;
    for (const r of (data ?? []) as {
      id: string;
      title: string | null;
      thumbnail_url: string | null;
      media_url: string | null;
      likes_count: number | null;
      views_count: number | null;
      comments_count: number | null;
      shares_count: number | null;
      saves_count: number | null;
    }[]) {
      const v = r.views_count ?? 0;
      const l = r.likes_count ?? 0;
      likes += l;
      views += v;
      comments += r.comments_count ?? 0;
      shares += r.shares_count ?? 0;
      saves += r.saves_count ?? 0;
      if (!topPost || v > topPost.views) {
        topPost = { id: r.id, title: r.title, thumbnailUrl: r.thumbnail_url ?? r.media_url, views: v, likes: l };
      }
    }
    return { likes, views, comments, shares, saves, topPost };
  } catch {
    return { likes: 0, views: 0, comments: 0, shares: 0, saves: 0, topPost: null };
  }
}

export async function topFriends(viewerId: string): Promise<{ name: string; handle: string; avatarUrl: string | null }[]> {
  try {
    const ids = [...(await friendIdSet(viewerId))].slice(0, 8);
    if (ids.length === 0) return [];
    const { data } = await createAdminClient().from("profiles").select("handle, display_name, avatar_url").in("id", ids).limit(5);
    return ((data ?? []) as { handle: string | null; display_name: string | null; avatar_url: string | null }[])
      .filter((p) => p.handle)
      .map((p) => ({ name: p.display_name || `@${p.handle}`, handle: p.handle as string, avatarUrl: p.avatar_url }));
  } catch {
    return [];
  }
}
