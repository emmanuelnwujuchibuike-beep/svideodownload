import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { relationshipStage, STAGE_COPY } from "@/lib/social/intelligence/stage";

import { buildStory, friendshipHealth, friendshipInsights, monthlyCounts, nextAnniversary, type FriendshipInsights, type HealthSignal, type StoryEvent, type StoryFacts } from "./story";

/**
 * The Friend Profile™ (Feature 19 · Part 7) for ONE friendship, as the viewer
 * sees it. Server-only, read with the admin client, and every read is scoped
 * to the two people: nothing here is reachable unless they are friends right
 * now (the caller checks that first, and returns 404 otherwise).
 *
 * Privacy rules applied here, not in the UI:
 *   · a friend's private SAVE of a post is never read (likes only)
 *   · mutual friends are listed only when the friend's own friends list is
 *     public (privacy_settings.followers_visibility), as everywhere else
 *   · sealed capsules arrive without their message
 *   · moments the viewer hid (0222) are left out before the page sees them
 *
 * About twelve small queries, run in two parallel batches, with no per-item loops.
 */

export interface FriendCard {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  profileVideoUrl: string | null;
  isVerified: boolean;
  bio: string | null;
}

export interface SharedMedia {
  id: string;
  kind: "image" | "video";
  url: string;
  thumbnailUrl: string | null;
  at: string;
}

export interface FriendGoal {
  id: string;
  title: string;
  done: boolean;
  doneAt: string | null;
  byViewer: boolean;
  createdAt: string;
}

export interface FriendCapsule {
  id: string;
  title: string;
  /** Null while sealed - never sent to the browser before it opens. */
  message: string | null;
  unlockAt: string;
  locked: boolean;
  fromViewer: boolean;
}

export interface FriendshipStory {
  friend: FriendCard;
  conversationId: string | null;
  events: StoryEvent[];
  nextAnniversary: { at: string; label: string } | null;
  health: HealthSignal[];
  insights: FriendshipInsights;
  mutuals: { shown: { id: string; handle: string; displayName: string; avatarUrl: string | null }[]; total: number; disclosed: boolean };
  media: SharedMedia[];
  goals: FriendGoal[];
  capsules: FriendCapsule[];
  starredCount: number;
  label: string | null;
  favorite: boolean;
  hiddenKinds: string[];
  /** Part 8: the relationship's stage, in words (never a score), and when you two talk, as 24 UTC hour counts. */
  stage: { label: string; line: string; archived: boolean };
  hourCounts: number[];
  /** The parts of the page that need a migration not yet run (0222) - shown as such, never as empty. */
  ready: { goals: boolean; capsules: boolean; hiding: boolean };
}

type Row = Record<string, unknown>;

export async function loadFriendshipStory(viewerId: string, handle: string, now = new Date()): Promise<FriendshipStory | null> {
  const db = createAdminClient();
  const { data: p } = await db.from("profiles").select("*").eq("handle", handle).maybeSingle();
  const prof = p as Row | null;
  if (!prof || prof.id === viewerId) return null;
  const friendId = prof.id as string;
  const low = viewerId < friendId ? viewerId : friendId;
  const high = viewerId < friendId ? friendId : viewerId;

  const { data: friendship } = await db.from("friendships").select("created_at").eq("user_low", low).eq("user_high", high).maybeSingle();
  if (!friendship) return null; // the page exists only for friends

  const friend: FriendCard = {
    id: friendId,
    handle: prof.handle as string,
    displayName: (prof.display_name as string) || `@${prof.handle as string}`,
    avatarUrl: (prof.avatar_url as string | null) ?? null,
    profileVideoUrl: (prof.profile_video_url as string | null) ?? null,
    isVerified: !!prof.is_verified,
    bio: (prof.bio as string | null) ?? null,
  };

  // ── batch 1 ────────────────────────────────────────────────────────────────
  const [conv, request, youFollow, theyFollow, label, fav, hiddenRes, goalsRes, capsulesRes, myFriends, theirFriends, privacy, prefRes] = await Promise.all([
    db.from("conversations").select("id").eq("type", "direct").eq("user_low", low).eq("user_high", high).maybeSingle(),
    db.from("friend_requests").select("sender_id, created_at").eq("status", "accepted").or(`and(sender_id.eq.${viewerId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${viewerId})`).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("follows").select("created_at").eq("follower_id", viewerId).eq("following_id", friendId).maybeSingle(),
    db.from("follows").select("created_at").eq("follower_id", friendId).eq("following_id", viewerId).maybeSingle(),
    db.from("relationship_labels").select("label").eq("owner_id", viewerId).eq("subject_id", friendId).limit(1).maybeSingle(),
    db.from("friend_favorites").select("user_id").eq("user_id", viewerId).eq("friend_id", friendId).maybeSingle(),
    db.from("friendship_timeline_hidden").select("kind").eq("owner_id", viewerId).eq("friend_id", friendId),
    db.from("friend_goals").select("id, title, created_by, done_at, done_by, created_at").eq("user_low", low).eq("user_high", high).order("created_at", { ascending: true }).limit(200),
    db.from("time_capsules").select("id, user_id, title, message, unlock_at").or(`and(user_id.eq.${viewerId},recipient_id.eq.${friendId}),and(user_id.eq.${friendId},recipient_id.eq.${viewerId})`).order("unlock_at", { ascending: true }).limit(100),
    db.from("friendships").select("user_low, user_high").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).limit(2000),
    db.from("friendships").select("user_low, user_high").or(`user_low.eq.${friendId},user_high.eq.${friendId}`).limit(2000),
    db.from("privacy_settings").select("followers_visibility").eq("user_id", friendId).maybeSingle(),
    db.from("relationship_prefs").select("archived_at").eq("owner_id", viewerId).eq("friend_id", friendId).maybeSingle(),
  ]);
  const conversationId = ((conv.data as Row | null)?.id as string | undefined) ?? null;

  // ── batch 2: the chat and posts, only once the conversation is known ──────
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const nth = (n: number) =>
    conversationId
      ? db.from("messages").select("created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).range(n - 1, n - 1).maybeSingle()
      : Promise.resolve({ data: null });
  /** The first time `actor` did something on a post published by `publisher`. */
  const firstOf = (table: string, actorCol: string, actor: string, publisher: string, only?: [string, string]) => {
    let q = db.from(table).select("created_at, posts!inner(publisher_id)").eq(actorCol, actor).eq("posts.publisher_id", publisher);
    if (only) q = q.eq(only[0], only[1]);
    return q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  };
  const [first, m100, m500, m1000, countRes, recentRes, lastRes, streakRes, mediaRes, starredRes, likeGiven, likeReceived, commentGiven, commentReceived, repostGiven, repostReceived] = await Promise.all([
    conversationId ? db.from("messages").select("created_at, sender_id").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    nth(100),
    nth(500),
    nth(1000),
    conversationId ? db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId) : Promise.resolve({ count: 0 }),
    conversationId ? db.from("messages").select("created_at").eq("conversation_id", conversationId).gte("created_at", yearAgo).order("created_at", { ascending: false }).limit(5000) : Promise.resolve({ data: [] }),
    conversationId ? db.from("messages").select("created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    conversationId ? db.from("conversation_streaks").select("longest_days").eq("conversation_id", conversationId).maybeSingle() : Promise.resolve({ data: null }),
    conversationId ? db.from("message_attachments").select("id, media_kind, media_url, thumbnail_url, created_at").eq("conversation_id", conversationId).in("media_kind", ["image", "video"]).order("created_at", { ascending: false }).limit(24) : Promise.resolve({ data: [] }),
    conversationId ? db.from("starred_messages").select("message_id, messages!inner(conversation_id)", { count: "exact", head: true }).eq("user_id", viewerId).eq("messages.conversation_id", conversationId) : Promise.resolve({ count: 0 }),
    // likes only: a 'save' is private to whoever saved
    firstOf("post_reactions", "user_id", viewerId, friendId, ["type", "like"]),
    firstOf("post_reactions", "user_id", friendId, viewerId, ["type", "like"]),
    firstOf("post_comments", "author_id", viewerId, friendId, ["status", "visible"]),
    firstOf("post_comments", "author_id", friendId, viewerId, ["status", "visible"]),
    firstOf("reposts", "user_id", viewerId, friendId),
    firstOf("reposts", "user_id", friendId, viewerId),
  ]);

  const at = (r: { data: unknown }) => ((r.data as Row | null)?.created_at as string | undefined) ?? null;
  const hiddenKinds = hiddenRes.error ? [] : ((hiddenRes.data ?? []) as { kind: string }[]).map((h) => h.kind);
  const goalsRows = goalsRes.error ? [] : ((goalsRes.data ?? []) as Row[]);
  const req = request.data as { sender_id: string; created_at: string } | null;
  const firstMsg = first.data as { created_at: string; sender_id: string } | null;

  const facts: StoryFacts = {
    friendName: friend.displayName,
    friendsSince: (friendship as { created_at: string }).created_at,
    request: req ? { at: req.created_at, byViewer: req.sender_id === viewerId } : null,
    youFollowedAt: at(youFollow),
    theyFollowedAt: at(theyFollow),
    firstMessage: firstMsg ? { at: firstMsg.created_at, byViewer: firstMsg.sender_id === viewerId } : null,
    messageMarks: ([[100, m100], [500, m500], [1000, m1000]] as const).flatMap(([n, r]) => (at(r) ? [{ n, at: at(r)! }] : [])),
    messageCount: (countRes as { count?: number | null }).count ?? 0,
    firstLikeGiven: at(likeGiven),
    firstLikeReceived: at(likeReceived),
    firstCommentGiven: at(commentGiven),
    firstCommentReceived: at(commentReceived),
    firstRepostGiven: at(repostGiven),
    firstRepostReceived: at(repostReceived),
    goalsDone: goalsRows.filter((g) => g.done_at).map((g) => ({ title: g.title as string, at: g.done_at as string, byViewer: g.done_by === viewerId })),
    monthly: monthlyCounts(((recentRes.data ?? []) as { created_at: string }[]).map((m) => m.created_at)),
    lastMessageAt: at(lastRes),
    longestStreakDays: Number((streakRes.data as Row | null)?.longest_days ?? 0),
  };

  // ── mutual friends, disclosed only when the friend's list is public ───────
  const other = (rows: unknown, me: string) => new Set(((rows ?? []) as { user_low: string; user_high: string }[]).map((f) => (f.user_low === me ? f.user_high : f.user_low)));
  const mine = other(myFriends.data, viewerId);
  const theirs = other(theirFriends.data, friendId);
  const mutualIds = [...mine].filter((id) => theirs.has(id));
  const disclosed = ((privacy.data as Row | null)?.followers_visibility ?? "public") === "public";
  let shown: FriendshipStory["mutuals"]["shown"] = [];
  if (disclosed && mutualIds.length) {
    const { data } = await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", mutualIds.slice(0, 12));
    shown = ((data ?? []) as Row[]).filter((r) => r.handle).map((r) => ({ id: r.id as string, handle: r.handle as string, displayName: (r.display_name as string) || `@${r.handle as string}`, avatarUrl: (r.avatar_url as string | null) ?? null }));
  }

  // Part 8: the stage, from the same facts (time together and your own chat)
  const recent = ((recentRes.data ?? []) as { created_at: string }[]).map((m) => Date.parse(m.created_at)).filter((t) => !Number.isNaN(t));
  const DAY = 86_400_000;
  const archived = !prefRes.error && !!(prefRes.data as Row | null)?.archived_at;
  const stage = relationshipStage({
    daysKnown: Math.floor((now.getTime() - Date.parse(facts.friendsSince)) / DAY),
    daysSinceMessage: facts.lastMessageAt ? Math.floor((now.getTime() - Date.parse(facts.lastMessageAt)) / DAY) : null,
    msgs90: recent.filter((t) => t >= now.getTime() - 90 * DAY).length,
    msgsPrev90: recent.filter((t) => t < now.getTime() - 90 * DAY && t >= now.getTime() - 180 * DAY).length,
    archived,
  });
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const t of recent) hourCounts[new Date(t).getUTCHours()]! += 1;

  return {
    friend,
    conversationId,
    stage: { label: STAGE_COPY[stage].label, line: STAGE_COPY[stage].line, archived },
    hourCounts,
    events: buildStory(facts, now, new Set(hiddenKinds)),
    nextAnniversary: nextAnniversary(facts.friendsSince, now),
    health: friendshipHealth(facts, now),
    insights: friendshipInsights(facts, now),
    mutuals: { shown, total: disclosed ? mutualIds.length : 0, disclosed },
    media: ((mediaRes.data ?? []) as Row[]).map((m) => ({ id: m.id as string, kind: m.media_kind as "image" | "video", url: m.media_url as string, thumbnailUrl: (m.thumbnail_url as string | null) ?? null, at: m.created_at as string })),
    goals: goalsRows.map((g) => ({ id: g.id as string, title: g.title as string, done: !!g.done_at, doneAt: (g.done_at as string | null) ?? null, byViewer: g.created_by === viewerId, createdAt: g.created_at as string })),
    capsules: (capsulesRes.error ? [] : ((capsulesRes.data ?? []) as Row[])).map((c) => {
      const locked = Date.parse(c.unlock_at as string) > now.getTime();
      return { id: c.id as string, title: c.title as string, message: locked ? null : (c.message as string), unlockAt: c.unlock_at as string, locked, fromViewer: c.user_id === viewerId };
    }),
    starredCount: (starredRes as { count?: number | null }).count ?? 0,
    label: ((label.data as Row | null)?.label as string | undefined) ?? null,
    favorite: !!fav.data,
    hiddenKinds,
    ready: { goals: !goalsRes.error, capsules: !capsulesRes.error, hiding: !hiddenRes.error },
  };
}
