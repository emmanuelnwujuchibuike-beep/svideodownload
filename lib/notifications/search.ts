import { CATEGORY_BY_TYPE, type NotificationCategory, type NotificationType } from "@/lib/platform/notifications-registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  INBOX SEARCH — plain-language queries, read by rules (Feature 20 Part 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "messages from chris", "security alerts last week", "unread downloads",
 * "payments this month", "urgent" (a label). The brief calls this an "AI Search
 * Assistant"; it is a small, explainable PARSER — every query is turned into
 * filters the member sees as chips ("Messages · from chris · last 7 days"), so
 * nothing is guessed in secret. Pure and shared: the Activity Center filters the
 * loaded list instantly with it, and the server runs the same parse over the whole
 * history (`listGroupedNotifications(…, { search })`).
 */
export interface ActivityQuery {
  /** what kinds: explicit types and/or whole categories */
  types: NotificationType[];
  categories: NotificationCategory[];
  /** "from X" / "by X" — matched against an actor's name or @handle */
  from: string | null;
  since: Date | null;
  until: Date | null;
  unread: boolean;
  pinned: boolean;
  held: boolean;
  /** a word that is one of the member's own labels */
  labels: string[];
  /** whatever is left, matched against the notification's words */
  words: string[];
  /** the human-readable reading, one chip per filter */
  chips: string[];
}

const ALL_TYPES = Object.keys(CATEGORY_BY_TYPE) as NotificationType[];
const typesWhere = (pred: (t: string) => boolean) => ALL_TYPES.filter(pred);

/** Words that name a kind of notification. Longest phrases first. */
const KINDS: [RegExp, { label: string; types?: NotificationType[]; categories?: NotificationCategory[] }][] = [
  [/\bfriend requests?\b/, { label: "Friend requests", types: ["friend_request", "friend_accepted", "friend_reminder"].filter((t) => ALL_TYPES.includes(t as NotificationType)) as NotificationType[] }],
  [/\b(messages?|chats?|dms?)\b/, { label: "Messages", types: typesWhere((t) => t.startsWith("message")) }],
  [/\b(mentions?|tags?|tagged)\b/, { label: "Mentions", types: typesWhere((t) => t === "mention" || t === "tag" || t === "message_mention") }],
  [/\b(comments?|replies|reply)\b/, { label: "Comments", types: typesWhere((t) => t === "comment" || t === "reply" || t === "comment_reaction") }],
  [/\b(likes?|loves?|wows?|reactions?)\b/, { label: "Likes", types: typesWhere((t) => t === "like" || t === "love" || t.endsWith("_reaction")) }],
  [/\b(follows?|followers?)\b/, { label: "Follows", types: typesWhere((t) => t === "follow") }],
  [/\b(subscribers?|members?|subscriptions?)\b/, { label: "Subscribers", types: typesWhere((t) => t === "member_joined" || t.startsWith("sub_") || t.startsWith("subscription")) }],
  [/\b(security|sign-?ins?|logins?|password|2fa)\b/, { label: "Security", categories: ["security"] }],
  [/\b(payments?|billing|deposits?|withdrawals?|invoices?|money|earnings)\b/, { label: "Payments", categories: ["premium"] }],
  [/\b(downloads?)\b/, { label: "Downloads", categories: ["downloads"] }],
  [/\b(communit(y|ies)|groups?)\b/, { label: "Communities", categories: ["community"] }],
  [/\b(news)\b/, { label: "News", categories: ["news"] }],
  [/\b(ai|ai tasks?|generations?)\b/, { label: "Frenz AI", types: typesWhere((t) => t.startsWith("ai_")) }],
  [/\b(announcements?|system|updates?)\b/, { label: "System", categories: ["system"] }],
];

const DAY = 86_400_000;
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse a query against `now` and the member's own labels (lower-case compare). */
export function parseActivityQuery(raw: string, now: Date, ownLabels: readonly string[] = []): ActivityQuery {
  const q: ActivityQuery = { types: [], categories: [], from: null, since: null, until: null, unread: false, pinned: false, held: false, labels: [], words: [], chips: [] };
  let s = ` ${raw.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = s.match(re);
    if (m) s = s.replace(re, " ");
    return m;
  };

  // who — "from chris", "by @ana"; one word or a quoted name
  const from = take(/\b(?:from|by)\s+(?:"([^"]+)"|@?([\p{L}\p{N}._-]+))/u);
  if (from) {
    q.from = (from[1] ?? from[2] ?? "").trim() || null;
    if (q.from) q.chips.push(`from ${q.from}`);
  }

  // when
  const today = startOfDay(now);
  const lastN = take(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  if (lastN) {
    q.since = new Date(today.getTime() - (Number(lastN[1]) - 1) * DAY);
    q.chips.push(`last ${lastN[1]} days`);
  } else if (take(/\btoday\b/)) {
    q.since = today;
    q.chips.push("today");
  } else if (take(/\byesterday\b/)) {
    q.since = new Date(today.getTime() - DAY);
    q.until = today;
    q.chips.push("yesterday");
  } else if (take(/\b(?:this|past) week\b/)) {
    q.since = new Date(today.getTime() - 6 * DAY);
    q.chips.push("last 7 days");
  } else if (take(/\blast week\b/)) {
    q.since = new Date(today.getTime() - 13 * DAY);
    q.until = new Date(today.getTime() - 6 * DAY);
    q.chips.push("the week before");
  } else if (take(/\bthis month\b/)) {
    q.since = new Date(now.getFullYear(), now.getMonth(), 1);
    q.chips.push("this month");
  } else if (take(/\blast month\b/)) {
    q.since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    q.until = new Date(now.getFullYear(), now.getMonth(), 1);
    q.chips.push("last month");
  }

  // state
  if (take(/\bunread\b/)) (q.unread = true), q.chips.push("unread");
  if (take(/\bpinned\b/)) (q.pinned = true), q.chips.push("pinned");
  if (take(/\bheld\b/)) (q.held = true), q.chips.push("held");

  // kinds
  for (const [re, kind] of KINDS) {
    if (!take(re)) continue;
    if (kind.types?.length) q.types.push(...kind.types);
    if (kind.categories?.length) q.categories.push(...kind.categories);
    q.chips.push(kind.label);
  }

  // the member's own labels, by name
  for (const label of ownLabels) {
    const re = new RegExp(`\\b${label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (take(re)) {
      q.labels.push(label);
      q.chips.push(`# ${label}`);
    }
  }

  // filler words never narrow anything
  q.words = s.split(" ").map((w) => w.trim()).filter((w) => w.length > 1 && !FILLER.has(w));
  if (q.words.length) q.chips.push(`“${q.words.join(" ")}”`);
  q.types = [...new Set(q.types)];
  q.categories = [...new Set(q.categories)];
  return q;
}

const FILLER = new Set(["my", "the", "a", "an", "all", "show", "me", "find", "and", "or", "of", "in", "on", "for", "about", "alerts", "alert", "notifications", "notification", "with", "to"]);

/** The fields a notification group offers to search. */
export interface Searchable {
  type: NotificationType;
  category: NotificationCategory;
  createdAt: string;
  read: boolean;
  pinned?: boolean;
  delivery?: string | null;
  labels?: string[];
  actors: { displayName: string; handle: string }[];
  /** its own words: title, body, post title, the kind's label */
  text: string;
}

export function matchesQuery(g: Searchable, q: ActivityQuery): boolean {
  if (q.types.length || q.categories.length) {
    if (!q.types.includes(g.type) && !q.categories.includes(g.category)) return false;
  }
  if (q.from) {
    const f = q.from.replace(/^@/, "");
    if (!g.actors.some((a) => a.displayName.toLowerCase().includes(f) || a.handle.toLowerCase().includes(f))) return false;
  }
  const at = Date.parse(g.createdAt);
  if (q.since && at < q.since.getTime()) return false;
  if (q.until && at >= q.until.getTime()) return false;
  if (q.unread && g.read) return false;
  if (q.pinned && !g.pinned) return false;
  if (q.held && g.delivery !== "held") return false;
  if (q.labels.length && !q.labels.every((l) => (g.labels ?? []).some((x) => x.toLowerCase() === l.toLowerCase()))) return false;
  if (q.words.length) {
    const hay = `${g.text} ${g.actors.map((a) => `${a.displayName} ${a.handle}`).join(" ")} ${(g.labels ?? []).join(" ")}`.toLowerCase();
    if (!q.words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** True when the query narrowed nothing (the box is empty or only filler). */
export function isEmptyQuery(q: ActivityQuery): boolean {
  return !q.types.length && !q.categories.length && !q.from && !q.since && !q.until && !q.unread && !q.pinned && !q.held && !q.labels.length && !q.words.length;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const MAX_LABELS = 5;
const LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} &'._-]{0,23}$/u;

/** Trim, de-duplicate (case-insensitive), validate, cap at five. Anything odd is dropped, never stored. */
export function cleanLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const l = v.replace(/\s+/g, " ").trim();
    if (!LABEL_RE.test(l)) continue;
    if (out.some((x) => x.toLowerCase() === l.toLowerCase())) continue;
    out.push(l);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}
