import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { cacheGet, cacheSet, getCached } from "@/lib/cache";
import {
  confidenceFor,
  matchesFilter,
  rankSuggestions,
  scoreSuggestion,
  type SuggestionCandidate,
  type SuggestionConfidence,
  type SuggestionFilter,
} from "@/lib/social/graph/suggestions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * People You May Know™ — the ONE recommendation engine (Feature 19 · Part 6).
 *
 * Every surface that suggests a person asks here: Add friends, the suggestions
 * launcher, and anything added later. The ranking and the sentence under each
 * person are the pure, tested functions in lib/social/graph/suggestions.ts,
 * and this file only GATHERS the evidence for them:
 *
 *   candidates  friends of friends · people your follows follow · people who
 *               follow you · your remembered contact matches (Part 5, privacy
 *               re-checked by the database) · a popular pool for a cold start
 *   evidence    mutual friends and follows (counted for ranking, NAMED only
 *               when every person involved has a public list), shared circles,
 *               same public location, the profile's own public type,
 *               verification, account age, interest overlap (ranking only:
 *               it comes from private watch history and is never named)
 *   removed     you, your friends, pending requests either way, blocks either
 *               way, people you muted or restricted, suspended, hidden or
 *               private profiles, accounts being deleted, opted-out members,
 *               and anyone you dismissed or snoozed
 *
 * Confidence is computed (confidenceFor) for ordering and for tests, and is
 * NEVER returned to a client. Cached per viewer for 60 s, and a piece of
 * feedback moves the viewer's cache version so the next read is fresh.
 */

export interface PersonSuggestion {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  isFollowing: boolean;
  /** The sentence shown under the person. Never names or counts a private connection. */
  reason: string;
  profileType: string;
}

/** Only for tests and server logs, never a response. */
export interface RankedInternal extends PersonSuggestion {
  score: number;
  confidence: SuggestionConfidence;
}

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
type Db = ReturnType<typeof createAdminClient>;

const VERSION_KEY = (viewer: string) => `pymk:v:${viewer}`;

/** Feedback changes what may be suggested - move the cache on, so the next read is fresh. */
export async function bumpSuggestionVersion(viewerId: string): Promise<void> {
  await cacheSet(VERSION_KEY(viewerId), Date.now(), 60 * 60 * 24).catch(() => {});
}

export async function peopleYouMayKnow(
  viewerId: string,
  opts: { filter?: SuggestionFilter; limit?: number; userClient?: SupabaseClient | null } = {},
): Promise<PersonSuggestion[]> {
  if (!hasSupabase) return [];
  const filter = opts.filter ?? "all";
  const limit = Math.min(50, Math.max(1, opts.limit ?? 24));
  const version = (await cacheGet<number>(VERSION_KEY(viewerId)).catch(() => null)) ?? 0;
  return getCached(`pymk:${viewerId}:${filter}:${limit}:${version}`, 60, async () => {
    try {
      const ranked = await rankForViewer(createAdminClient(), viewerId, filter, limit, opts.userClient ?? null);
      // strip the internals: confidence and score never leave the server
      return ranked.map(({ score: _s, confidence: _c, ...p }) => p);
    } catch {
      return [];
    }
  });
}

type Row = Record<string, unknown>;
const ids = (rows: unknown, col: string): string[] => ((rows ?? []) as Row[]).map((r) => r[col] as string).filter(Boolean);

/** Exported for tests: the whole pipeline over a database client. */
export async function rankForViewer(db: Db, viewer: string, filter: SuggestionFilter, limit: number, userClient: SupabaseClient | null): Promise<RankedInternal[]> {
  // ── 1 · the viewer's own graph ─────────────────────────────────────────────
  const [friendsRes, followingRes, followersRes, requestsRes, feedbackRes, meRes, contactsRes] = await Promise.all([
    db.from("friendships").select("user_low, user_high").or(`user_low.eq.${viewer},user_high.eq.${viewer}`).limit(1000),
    db.from("follows").select("following_id").eq("follower_id", viewer).limit(1000),
    db.from("follows").select("follower_id").eq("following_id", viewer).order("created_at", { ascending: false }).limit(300),
    db.from("friend_requests").select("sender_id, receiver_id").eq("status", "pending").or(`sender_id.eq.${viewer},receiver_id.eq.${viewer}`).limit(500),
    db.from("people_suggestion_feedback").select("subject_id, action, snooze_until").eq("viewer_id", viewer).limit(5000),
    db.from("profiles").select("location").eq("id", viewer).maybeSingle(),
    userClient ? userClient.rpc("my_contact_matches") : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  const friends = new Set(((friendsRes.data ?? []) as { user_low: string; user_high: string }[]).map((f) => (f.user_low === viewer ? f.user_high : f.user_low)));
  const following = new Set(ids(followingRes.data, "following_id"));
  const followers = new Set(ids(followersRes.data, "follower_id"));
  const pending = new Set<string>();
  for (const r of (requestsRes.data ?? []) as { sender_id: string; receiver_id: string }[]) pending.add(r.sender_id === viewer ? r.receiver_id : r.sender_id);
  const now = Date.now();
  const dismissed = new Set<string>();
  // before 0221 runs the table is missing: no feedback, which is the true state
  for (const f of (feedbackRes.error ? [] : feedbackRes.data ?? []) as { subject_id: string; action: string; snooze_until: string | null }[]) {
    if (f.action !== "later" || (f.snooze_until && Date.parse(f.snooze_until) > now)) dismissed.add(f.subject_id);
  }
  const myLocation = ((meRes.data as { location?: string | null } | null)?.location ?? "").trim().toLowerCase();
  const contacts = new Set(
    contactsRes.error ? [] : ((contactsRes.data ?? []) as (string | { my_contact_matches: string })[]).map((r) => (typeof r === "string" ? r : r.my_contact_matches)),
  );

  // ── 2 · candidates ─────────────────────────────────────────────────────────
  const mutualFriends = new Map<string, Set<string>>();
  const mutualFollows = new Map<string, Set<string>>();
  const friendIds = [...friends].slice(0, 300);
  const followIds = [...following].slice(0, 300);
  const [fofRes, mfRes, popularRes] = await Promise.all([
    friendIds.length
      ? db.from("friendships").select("user_low, user_high").or(`user_low.in.(${friendIds.join(",")}),user_high.in.(${friendIds.join(",")})`).limit(5000)
      : Promise.resolve({ data: [] as Row[] }),
    followIds.length ? db.from("follows").select("follower_id, following_id").in("follower_id", followIds).limit(5000) : Promise.resolve({ data: [] as Row[] }),
    db.from("profiles").select("id").not("handle", "is", null).eq("is_suspended", false).order("followers_count", { ascending: false }).limit(60),
  ]);
  for (const f of (fofRes.data ?? []) as { user_low: string; user_high: string }[]) {
    // an edge friend–X where friend is mine: X is a friend of a friend, through that friend
    for (const [mine, other] of [[f.user_low, f.user_high], [f.user_high, f.user_low]] as const) {
      if (!friends.has(mine) || other === viewer || friends.has(other)) continue;
      if (!mutualFriends.has(other)) mutualFriends.set(other, new Set());
      mutualFriends.get(other)!.add(mine);
    }
  }
  for (const f of (mfRes.data ?? []) as { follower_id: string; following_id: string }[]) {
    if (f.following_id === viewer) continue;
    if (!mutualFollows.has(f.following_id)) mutualFollows.set(f.following_id, new Set());
    mutualFollows.get(f.following_id)!.add(f.follower_id);
  }
  const pool = new Set<string>([...mutualFriends.keys(), ...mutualFollows.keys(), ...followers, ...contacts, ...ids(popularRes.data, "id")]);
  for (const x of [viewer, ...friends, ...pending, ...dismissed]) pool.delete(x);
  // a cheap pre-rank keeps hydration bounded however large the graph is
  const pre = (id: string) => (mutualFriends.get(id)?.size ?? 0) * 3 + (mutualFollows.get(id)?.size ?? 0) + (contacts.has(id) ? 10 : 0) + (followers.has(id) ? 5 : 0);
  const candidateIds = [...pool].sort((a, b) => pre(b) - pre(a)).slice(0, 300);
  if (!candidateIds.length) return [];

  // ── 3 · evidence ───────────────────────────────────────────────────────────
  const involved = new Set<string>();
  for (const id of candidateIds) {
    for (const m of mutualFriends.get(id) ?? []) involved.add(m);
    for (const m of mutualFollows.get(id) ?? []) involved.add(m);
  }
  const [profiles, privacyRes, blocksRes, mutedRes, restrictedRes, circlesRes, interestsRes] = await Promise.all([
    readProfiles(db, candidateIds),
    db.from("privacy_settings").select("user_id, show_in_recommendations, followers_visibility").in("user_id", [...new Set([...candidateIds, ...involved])].slice(0, 1000)),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewer},blocked_id.eq.${viewer}`),
    db.from("muted_creators").select("muted_id").eq("muter_id", viewer),
    db.from("user_restrictions").select("restricted_id").eq("restrictor_id", viewer),
    db.from("circle_members").select("member_id").eq("owner_id", viewer).in("member_id", candidateIds),
    db.from("user_interest_profile").select("user_id, category, weight").in("user_id", [viewer, ...candidateIds]).limit(6000),
  ]);
  const privacy = new Map(((privacyRes.data ?? []) as { user_id: string; show_in_recommendations: boolean; followers_visibility: string }[]).map((p) => [p.user_id, p]));
  // a member with no privacy row has the defaults: public lists, recommendations on
  const listPublic = (id: string) => (privacy.get(id)?.followers_visibility ?? "public") === "public";
  const blocked = new Set<string>();
  for (const b of (blocksRes.data ?? []) as { blocker_id: string; blocked_id: string }[]) blocked.add(b.blocker_id === viewer ? b.blocked_id : b.blocker_id);
  const suppressed = new Set([...ids(mutedRes.data, "muted_id"), ...ids(restrictedRes.data, "restricted_id")]);
  const circleCount = new Map<string, number>();
  for (const id of ids(circlesRes.data, "member_id")) circleCount.set(id, (circleCount.get(id) ?? 0) + 1);
  const interests = interestVectors((interestsRes.data ?? []) as { user_id: string; category: string; weight: number }[]);
  const mine = interests.get(viewer);

  const candidates: SuggestionCandidate[] = [];
  for (const id of candidateIds) {
    const p = profiles.get(id);
    if (!p) continue;
    const mf = mutualFriends.get(id) ?? new Set<string>();
    const mfo = mutualFollows.get(id) ?? new Set<string>();
    candidates.push({
      id,
      mutualFriends: mf.size,
      mutualsDisclosable: mf.size > 0 && [...mf].every(listPublic),
      optedOut: privacy.get(id)?.show_in_recommendations === false,
      isSuspended: p.is_suspended,
      isHidden: p.is_hidden || p.visibility !== "public" || p.deleting,
      blockedEitherWay: blocked.has(id),
      suppressedByViewer: suppressed.has(id),
      alreadyFriend: friends.has(id),
      alreadyFollowing: following.has(id),
      requestPending: pending.has(id),
      sameLocation: !!myLocation && p.location === myLocation,
      sharedCircles: circleCount.get(id) ?? 0,
      followers: p.followers_count,
      accountAgeDays: p.created_at ? Math.floor((now - Date.parse(p.created_at)) / 86_400_000) : null,
      inContacts: contacts.has(id),
      followsViewer: followers.has(id),
      mutualFollows: mfo.size,
      mutualFollowsDisclosable: mfo.size > 0 && [...mfo].every(listPublic),
      interestOverlap: mine ? overlap(mine, interests.get(id)) : 0,
      profileType: p.profile_type,
      isVerified: p.is_verified,
      dismissed: dismissed.has(id),
    });
  }

  // already-followed people are suggested only as FRIENDS (with real evidence), never as a follow
  const usable = candidates.filter((c) => matchesFilter(c, filter) && (!c.alreadyFollowing || c.mutualFriends > 0 || c.inContacts || c.followsViewer));
  const byId = new Map(usable.map((c) => [c.id, c]));
  return rankSuggestions(usable, { viewerId: viewer }, limit).map((s) => {
    const p = profiles.get(s.id)!;
    const c = byId.get(s.id)!;
    return {
      id: s.id,
      handle: p.handle,
      displayName: p.display_name || `@${p.handle}`,
      avatarUrl: p.avatar_url,
      isVerified: p.is_verified,
      followersCount: p.followers_count,
      isFollowing: c.alreadyFollowing,
      reason: s.reason,
      profileType: p.profile_type,
      score: scoreSuggestion(c),
      confidence: confidenceFor(s.score),
    };
  });
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  followers_count: number;
  is_suspended: boolean;
  is_hidden: boolean;
  visibility: string;
  location: string;
  created_at: string | null;
  profile_type: string;
  deleting: boolean;
}

/** Newer columns (location 0xx, profile_type 0107, deletion_requested_at) are read when present, and the list still works without them. */
async function readProfiles(db: Db, list: string[]): Promise<Map<string, ProfileRow>> {
  const base = "id, handle, display_name, avatar_url, is_verified, followers_count, is_suspended, is_hidden, visibility, created_at";
  const full = await db.from("profiles").select(`${base}, location, profile_type, deletion_requested_at`).in("id", list);
  const rows = (full.error ? (await db.from("profiles").select(base).in("id", list)).data : full.data) as Row[] | null;
  const out = new Map<string, ProfileRow>();
  for (const r of rows ?? []) {
    if (!r.handle) continue;
    out.set(r.id as string, {
      id: r.id as string,
      handle: r.handle as string,
      display_name: (r.display_name as string | null) ?? null,
      avatar_url: (r.avatar_url as string | null) ?? null,
      is_verified: !!r.is_verified,
      followers_count: Number(r.followers_count ?? 0),
      is_suspended: !!r.is_suspended,
      is_hidden: !!r.is_hidden,
      visibility: (r.visibility as string) ?? "public",
      location: String(r.location ?? "").trim().toLowerCase(),
      created_at: (r.created_at as string | null) ?? null,
      profile_type: (r.profile_type as string) ?? "personal",
      deleting: !!r.deletion_requested_at,
    });
  }
  return out;
}

function interestVectors(rows: { user_id: string; category: string; weight: number }[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!(r.weight > 0)) continue;
    if (!out.has(r.user_id)) out.set(r.user_id, new Map());
    out.get(r.user_id)!.set(r.category, r.weight);
  }
  return out;
}

/** Cosine similarity of two interest vectors, 0..1. */
export function overlap(a: Map<string, number>, b: Map<string, number> | undefined): number {
  if (!b || !a.size || !b.size) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
