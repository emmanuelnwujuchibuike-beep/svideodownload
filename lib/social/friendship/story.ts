/**
 * Relationship Timeline™, Friendship Health™ and Friendship Insights™
 * (Feature 19 · Part 7) — pure, no I/O.
 *
 * Every moment here is a timestamp some table already owns (see the 0222
 * header and lib/social/graph/milestones.ts): friendships, friend_requests,
 * follows, messages, likes, comments, reposts, the bucket list. Nothing is
 * inferred or invented. A friendship that has no first message simply has no
 * "first message" moment, rather than a guessed one.
 *
 * Direction is always told from the VIEWER's side ("You sent", "They liked
 * your post"), and only about things the viewer can already see: their own
 * actions, and the friend's public actions on the viewer's own posts. A
 * friend's private SAVE of a post is never read (post_reactions type 'save').
 *
 * All dates are UTC, so a timeline does not shift when someone travels.
 */

export type StoryKind =
  | "request_sent"
  | "friends_since"
  | "you_followed"
  | "they_followed"
  | "first_message"
  | "messages_100"
  | "messages_500"
  | "messages_1000"
  | "first_like_given"
  | "first_like_received"
  | "first_comment_given"
  | "first_comment_received"
  | "first_repost_given"
  | "first_repost_received"
  | "goal_done"
  | "anniversary";

/** The kinds a member may take off their own view (0222 friendship_timeline_hidden). Anniversaries and "friends since" always stay. */
export const HIDEABLE_KINDS: readonly StoryKind[] = [
  "request_sent",
  "you_followed",
  "they_followed",
  "first_message",
  "messages_100",
  "messages_500",
  "messages_1000",
  "first_like_given",
  "first_like_received",
  "first_comment_given",
  "first_comment_received",
  "first_repost_given",
  "first_repost_received",
  "goal_done",
];
export function isHideableKind(v: unknown): v is StoryKind {
  return typeof v === "string" && (HIDEABLE_KINDS as readonly string[]).includes(v);
}

export interface StoryEvent {
  kind: StoryKind;
  at: string;
  title: string;
  detail?: string;
}

/** The raw facts, each an ISO timestamp (or null when it never happened). */
export interface StoryFacts {
  friendName: string;
  friendsSince: string;
  /** Who sent the request that became this friendship, when it is known. */
  request: { at: string; byViewer: boolean } | null;
  youFollowedAt: string | null;
  theyFollowedAt: string | null;
  firstMessage: { at: string; byViewer: boolean } | null;
  /** When the Nth message of the chat was sent, for N = 100, 500, 1000. */
  messageMarks: { n: 100 | 500 | 1000; at: string }[];
  messageCount: number;
  firstLikeGiven: string | null;
  firstLikeReceived: string | null;
  firstCommentGiven: string | null;
  firstCommentReceived: string | null;
  firstRepostGiven: string | null;
  firstRepostReceived: string | null;
  goalsDone: { title: string; at: string; byViewer: boolean }[];
  /** Messages per UTC month "YYYY-MM", over the last year at most. */
  monthly: Record<string, number>;
  lastMessageAt: string | null;
  longestStreakDays: number;
}

const DAY = 86_400_000;

/** Anniversaries the brief names: 1 month, 6 months, then every year. Returns those already reached. */
export function anniversariesReached(since: string, now: Date): { at: string; label: string }[] {
  const s = new Date(since);
  if (Number.isNaN(s.getTime())) return [];
  const out: { at: string; label: string }[] = [];
  const addMonths = (m: number) => {
    const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + m, 1, s.getUTCHours(), s.getUTCMinutes()));
    // clamp to the month's last day (31 Jan + 1 month = 28/29 Feb)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(s.getUTCDate(), last));
    return d;
  };
  for (const [m, label] of [[1, "1 month of friendship"], [6, "6 months of friendship"]] as const) {
    const d = addMonths(m);
    if (d <= now) out.push({ at: d.toISOString(), label });
  }
  for (let y = 1; y <= 100; y += 1) {
    const d = addMonths(12 * y);
    if (d > now) break;
    out.push({ at: d.toISOString(), label: y === 1 ? "1 year of friendship" : `${y} years of friendship` });
  }
  return out;
}

/** The next anniversary still to come (1 month, 6 months, or the next year). */
export function nextAnniversary(since: string, now: Date): { at: string; label: string } | null {
  const reached = anniversariesReached(since, new Date(8.64e15)).filter((a) => new Date(a.at) > now);
  return reached[0] ?? null;
}

export function buildStory(f: StoryFacts, now: Date, hidden: ReadonlySet<string> = new Set()): StoryEvent[] {
  const ev: StoryEvent[] = [];
  const them = f.friendName;
  const push = (kind: StoryKind, at: string | null | undefined, title: string, detail?: string) => {
    // only a HIDEABLE kind can be hidden: the friendship itself and its anniversaries always stay
    if (!at || Number.isNaN(Date.parse(at)) || (hidden.has(kind) && isHideableKind(kind))) return;
    ev.push(detail ? { kind, at, title, detail } : { kind, at, title });
  };
  if (f.request) push("request_sent", f.request.at, f.request.byViewer ? `You sent ${them} a friend request` : `${them} sent you a friend request`);
  push("friends_since", f.friendsSince, "You became friends");
  push("you_followed", f.youFollowedAt, `You followed ${them}`);
  push("they_followed", f.theyFollowedAt, `${them} followed you`);
  if (f.firstMessage) push("first_message", f.firstMessage.at, "Your first conversation", f.firstMessage.byViewer ? "You said hello first" : `${them} said hello first`);
  for (const m of f.messageMarks) push(`messages_${m.n}` as StoryKind, m.at, `${m.n.toLocaleString("en")} messages together`);
  push("first_like_given", f.firstLikeGiven, `You first liked a post by ${them}`);
  push("first_like_received", f.firstLikeReceived, `${them} first liked your post`);
  push("first_comment_given", f.firstCommentGiven, `Your first comment on ${them}'s post`);
  push("first_comment_received", f.firstCommentReceived, `${them}'s first comment on your post`);
  push("first_repost_given", f.firstRepostGiven, `You first reposted ${them}`);
  push("first_repost_received", f.firstRepostReceived, `${them} first reposted you`);
  for (const g of f.goalsDone) push("goal_done", g.at, `Ticked off: ${g.title}`, g.byViewer ? "Marked done by you" : `Marked done by ${them}`);
  for (const a of anniversariesReached(f.friendsSince, now)) ev.push({ kind: "anniversary", at: a.at, title: a.label });
  // newest first; on the same instant the friendship itself leads
  return ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === "friends_since" ? -1 : b.kind === "friends_since" ? 1 : 0));
}

/**
 * Friendship Health™ — informational only, never a score, never public, never
 * compared with anyone else's. Several can be true at once.
 */
export type HealthSignal = "recently_active" | "growing" | "long_time" | "dormant" | "new";
export const HEALTH_LABEL: Record<HealthSignal, string> = {
  recently_active: "Recently active",
  growing: "Growing connection",
  long_time: "Long-time friends",
  dormant: "Quiet lately",
  new: "New friends",
};

export function friendshipHealth(f: StoryFacts, now: Date): HealthSignal[] {
  const out: HealthSignal[] = [];
  const since = Date.parse(f.friendsSince);
  const ageDays = Number.isNaN(since) ? 0 : (now.getTime() - since) / DAY;
  const last = f.lastMessageAt ? Date.parse(f.lastMessageAt) : NaN;
  const sinceLast = Number.isNaN(last) ? Infinity : (now.getTime() - last) / DAY;
  if (ageDays < 30) out.push("new");
  if (sinceLast <= 14) out.push("recently_active");
  const month = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return f.monthly[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`] ?? 0;
  };
  // this month and last month against the two before them
  const recent = month(0) + month(1);
  const before = month(2) + month(3);
  if (recent > 0 && recent > before * 1.25 && ageDays >= 60) out.push("growing");
  if (ageDays >= 365) out.push("long_time");
  if (ageDays >= 90 && sinceLast > 90) out.push("dormant");
  return out;
}

export interface FriendshipInsights {
  messages: number;
  /** "YYYY-MM" of the busiest month in the last year, when there was one. */
  mostActiveMonth: string | null;
  mostActiveMonthMessages: number;
  longestStreakDays: number;
  daysAsFriends: number;
}

export function friendshipInsights(f: StoryFacts, now: Date): FriendshipInsights {
  let best: string | null = null;
  let bestN = 0;
  for (const [m, n] of Object.entries(f.monthly)) {
    if (n > bestN || (n === bestN && best !== null && m > best)) {
      best = m;
      bestN = n;
    }
  }
  const since = Date.parse(f.friendsSince);
  return {
    messages: f.messageCount,
    mostActiveMonth: bestN > 0 ? best : null,
    mostActiveMonthMessages: bestN,
    longestStreakDays: f.longestStreakDays,
    daysAsFriends: Number.isNaN(since) ? 0 : Math.max(0, Math.floor((now.getTime() - since) / DAY)),
  };
}

/** "2026-03" → "March 2026" (English, UTC). */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Group messages by UTC month. */
export function monthlyCounts(timestamps: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of timestamps) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
