import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { evolutionFor, reconnectReason, relationshipStage, STAGE_COPY, upcomingAnniversaries, type Evolution, type Moment, type RelationshipStage } from "./stage";

/**
 * Relationship Intelligence™ — the ONE server read every surface uses
 * (Feature 19 · Part 8: "Social Intelligence API, everything centralized").
 *
 * For the signed-in member only: their friendships, their own chats (counted
 * in the database by relationship_activity, 0223), their private archive and
 * reconnect choices, their follows. Nothing about how anyone behaves toward
 * them. Every result is a word, a sentence or a person, never a score.
 *
 * Fails soft before 0223 runs: no archive, no snoozes, and message activity
 * read from each conversation's last message only.
 */

export interface IntelPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export interface IntelRelationship {
  person: IntelPerson;
  stage: RelationshipStage;
  stageLabel: string;
  stageLine: string;
  since: string;
  archived: boolean;
  /** Set when a gentle reconnect nudge applies (and it was not snoozed or turned off). */
  reconnect: string | null;
}

export interface RelationshipIntelligence {
  relationships: IntelRelationship[];
  evolutions: { person: IntelPerson; evolution: Evolution }[];
  moments: (Moment & { person: IntelPerson | null })[];
  ready: { prefs: boolean; activity: boolean };
}

type Row = Record<string, unknown>;
const DAY = 86_400_000;

export async function relationshipIntelligence(viewerId: string, now = new Date()): Promise<RelationshipIntelligence> {
  const db = createAdminClient();

  // ── batch 1: the viewer's graph and choices ────────────────────────────────
  const [friendsRes, prefsRes, activityRes, followingRes, followersRes, requestsRes, labelsRes, capsulesRes] = await Promise.all([
    db.from("friendships").select("user_low, user_high, created_at").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).limit(2000),
    db.from("relationship_prefs").select("friend_id, archived_at, reconnect_snoozed_until, reconnect_off").eq("owner_id", viewerId).limit(2000),
    db.rpc("relationship_activity", { p_viewer: viewerId }),
    db.from("follows").select("following_id").eq("follower_id", viewerId).limit(2000),
    db.from("follows").select("follower_id").eq("following_id", viewerId).limit(2000),
    db.from("friend_requests").select("sender_id, receiver_id").eq("status", "pending").or(`sender_id.eq.${viewerId},receiver_id.eq.${viewerId}`).limit(500),
    db.from("relationship_labels").select("subject_id").eq("owner_id", viewerId).limit(2000),
    db
      .from("time_capsules")
      .select("id, user_id, recipient_id, title, unlock_at")
      .or(`recipient_id.eq.${viewerId},and(user_id.eq.${viewerId},recipient_id.not.is.null)`)
      .gte("unlock_at", new Date(now.getTime() - DAY).toISOString())
      .lte("unlock_at", new Date(now.getTime() + 7 * DAY).toISOString())
      .limit(50),
  ]);

  const friends = new Map<string, string>(); // id -> since
  for (const f of (friendsRes.data ?? []) as { user_low: string; user_high: string; created_at: string }[]) friends.set(f.user_low === viewerId ? f.user_high : f.user_low, f.created_at);
  const prefs = new Map<string, { archived_at: string | null; reconnect_snoozed_until: string | null; reconnect_off: boolean }>();
  for (const p of (prefsRes.error ? [] : prefsRes.data ?? []) as { friend_id: string; archived_at: string | null; reconnect_snoozed_until: string | null; reconnect_off: boolean }[]) prefs.set(p.friend_id, p);
  const activity = new Map<string, { msgs_90: number; msgs_prev_90: number; last_message_at: string | null }>();
  for (const a of (activityRes.error ? [] : activityRes.data ?? []) as { friend_id: string; msgs_90: number; msgs_prev_90: number; last_message_at: string | null }[]) activity.set(a.friend_id, a);
  const following = new Set(((followingRes.data ?? []) as Row[]).map((r) => r.following_id as string));
  const followers = new Set(((followersRes.data ?? []) as Row[]).map((r) => r.follower_id as string));
  const pending = new Set<string>();
  for (const r of (requestsRes.data ?? []) as { sender_id: string; receiver_id: string }[]) pending.add(r.sender_id === viewerId ? r.receiver_id : r.sender_id);
  const labelled = new Set(((labelsRes.data ?? []) as Row[]).map((r) => r.subject_id as string));
  const capsules = (capsulesRes.error ? [] : capsulesRes.data ?? []) as { id: string; user_id: string; recipient_id: string; title: string; unlock_at: string }[];

  // before 0223: the last message of each direct chat, from the conversations themselves
  if (activityRes.error && friends.size) {
    const { data } = await db.from("conversations").select("user_low, user_high, last_message_at").eq("type", "direct").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).limit(2000);
    for (const c of (data ?? []) as { user_low: string; user_high: string; last_message_at: string | null }[]) {
      activity.set(c.user_low === viewerId ? c.user_high : c.user_low, { msgs_90: 0, msgs_prev_90: 0, last_message_at: c.last_message_at });
    }
  }

  // mutual follows that are not yet friendships: Relationship Evolution's one certain signal
  const mutualFollows = [...following].filter((id) => followers.has(id) && !friends.has(id) && !pending.has(id) && id !== viewerId).slice(0, 50);

  // ── batch 2: the people ────────────────────────────────────────────────────
  const ids = [...new Set([...friends.keys(), ...mutualFollows])];
  const people = new Map<string, IntelPerson & { profileType: string }>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const full = await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, profile_type").in("id", chunk);
    const rows = (full.error ? (await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified").in("id", chunk)).data : full.data) as Row[] | null;
    for (const r of rows ?? []) {
      if (!r.handle) continue;
      people.set(r.id as string, {
        id: r.id as string,
        handle: r.handle as string,
        displayName: (r.display_name as string) || `@${r.handle as string}`,
        avatarUrl: (r.avatar_url as string | null) ?? null,
        isVerified: !!r.is_verified,
        profileType: (r.profile_type as string) ?? "personal",
      });
    }
  }
  const card = (id: string): IntelPerson | null => {
    const p = people.get(id);
    return p ? { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, isVerified: p.isVerified } : null;
  };

  const relationships: IntelRelationship[] = [];
  const evolutions: RelationshipIntelligence["evolutions"] = [];
  for (const [id, since] of friends) {
    const person = card(id);
    if (!person) continue;
    const a = activity.get(id);
    const p = prefs.get(id);
    const archived = !!p?.archived_at;
    const daysSinceMessage = a?.last_message_at ? Math.floor((now.getTime() - Date.parse(a.last_message_at)) / DAY) : null;
    const stage = relationshipStage({ daysKnown: Math.floor((now.getTime() - Date.parse(since)) / DAY), daysSinceMessage, msgs90: a?.msgs_90 ?? 0, msgsPrev90: a?.msgs_prev_90 ?? 0, archived });
    relationships.push({
      person,
      stage,
      stageLabel: STAGE_COPY[stage].label,
      stageLine: STAGE_COPY[stage].line,
      since,
      archived,
      reconnect: reconnectReason({ daysSinceMessage, archived, reconnectOff: !!p?.reconnect_off, snoozedUntil: p?.reconnect_snoozed_until ?? null, now }),
    });
    if (!archived) {
      const e = evolutionFor({ isFriend: true, youFollow: following.has(id), theyFollow: followers.has(id), requestPending: false, profileType: people.get(id)?.profileType ?? "personal", hasLabel: labelled.has(id) });
      if (e) evolutions.push({ person, evolution: e });
    }
  }
  for (const id of mutualFollows) {
    const person = card(id);
    const e = evolutionFor({ isFriend: false, youFollow: true, theyFollow: true, requestPending: false, profileType: people.get(id)?.profileType ?? "personal", hasLabel: labelled.has(id) });
    if (person && e) evolutions.push({ person, evolution: e });
  }

  const live = relationships.filter((r) => !r.archived);
  const moments: RelationshipIntelligence["moments"] = [
    ...upcomingAnniversaries(live.map((r) => ({ id: r.person.id, name: r.person.displayName, since: r.since })), now).map((m) => ({ ...m, person: card(m.friendId) })),
    ...capsules.map((c) => {
      const other = c.user_id === viewerId ? c.recipient_id : c.user_id;
      const who = card(other)?.displayName ?? "a friend";
      return {
        kind: "capsule" as const,
        at: c.unlock_at,
        title: c.user_id === viewerId ? `Your capsule for ${who} opens: “${c.title}”` : `A capsule from ${who} opens: “${c.title}”`,
        friendId: other,
        person: card(other),
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return { relationships, evolutions: evolutions.slice(0, 12), moments, ready: { prefs: !prefsRes.error, activity: !activityRes.error } };
}

/** The archived friend ids, for surfaces that hide them (the Friends list). Empty before 0223. */
export async function archivedFriendIds(viewerId: string): Promise<Set<string>> {
  try {
    const { data, error } = await createAdminClient().from("relationship_prefs").select("friend_id").eq("owner_id", viewerId).not("archived_at", "is", null).limit(2000);
    if (error) return new Set();
    return new Set(((data ?? []) as Row[]).map((r) => r.friend_id as string));
  } catch {
    return new Set();
  }
}
