/**
 * Friend Lists™ & the Relationship Manager™ — the pure rules (Feature 19 · Part 10).
 *
 * ── A list IS a circle ────────────────────────────────────────────────────
 * Circles (0112, 0217) are already private lists: owner-only, many per
 * person, coloured, with a real permission behind them. 0225 adds nesting,
 * archiving, private tags and rules. Nothing here invents a second list store.
 *
 * ── Smart lists are filters, not rows ─────────────────────────────────────
 * "Verified", "New friends", "Creators" are questions about the graph, so they
 * are answered from it every time and can never go stale. Only a list the
 * member curates is stored.
 *
 * ── AI organizes, the member decides ──────────────────────────────────────
 * The organization engine is transparent rules over the member's OWN lists
 * and connections: overlap between two lists, a list nobody has used, friends
 * in no list. Every suggestion names what it would do and does nothing until
 * tapped. It never reads anything about a person beyond what their profile
 * already says publicly (verified, creator, business).
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface DirectoryPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  /** profiles.profile_type: personal, creator, business, professional, student… */
  profileType: string;
  friend: boolean;
  following: boolean;
  follower: boolean;
  favorite: boolean;
  /** Part 8: archived friendship (private) */
  archived: boolean;
  /** when the friendship (or else the earliest follow) began */
  since: string | null;
  /** the ONE private relationship label (relationship_labels) */
  label: string | null;
  /** private tags (0225) */
  tags: string[];
  /** the member's list ids this person is in */
  listIds: string[];
  /** messages in your chat with them in the last 90 days (Part 8 relationship_activity), when known */
  recentMessages: number | null;
}

export interface ListNode {
  id: string;
  name: string;
  color: string;
  icon: string;
  kind: string;
  memberCount: number;
  parentId: string | null;
  archived: boolean;
  description: string | null;
  createdAt: string | null;
}

export interface ListRule {
  id: string;
  circleId: string;
  rule: RuleKind;
  value: string | null;
}

const DAY = 86_400_000;
export const NEW_FRIEND_DAYS = 30;
export const MAX_TAGS_PER_PERSON = 10;
export const MAX_TAG_LENGTH = 24;
export const MAX_LIST_DEPTH = 4;
export const MAX_RULES_PER_LIST = 8;

const isCreator = (p: DirectoryPerson) => p.profileType === "creator";
const isBusiness = (p: DirectoryPerson) => p.profileType === "business" || p.profileType === "professional";
const isNewFriend = (p: DirectoryPerson, now: number) => p.friend && !!p.since && now - Date.parse(p.since) <= NEW_FRIEND_DAYS * DAY;

// ─── Smart Lists™ ────────────────────────────────────────────────────────────

export const SMART_LISTS = [
  { key: "friends", label: "Friends", blurb: "Everyone you're friends with." },
  { key: "followers", label: "Followers", blurb: "People who follow you." },
  { key: "following", label: "Following", blurb: "People you follow." },
  { key: "mutual", label: "Follow each other", blurb: "You follow each other but aren't friends yet." },
  { key: "favorites", label: "Favourites", blurb: "Friends you starred." },
  { key: "new_friends", label: "New friends", blurb: "Friends from the last month." },
  { key: "online", label: "Online now", blurb: "Connections who are online and let you see it." },
  { key: "verified", label: "Verified", blurb: "Verified accounts you're connected to." },
  { key: "creators", label: "Creators", blurb: "Creator profiles you're connected to." },
  { key: "businesses", label: "Businesses", blurb: "Business and professional profiles." },
  { key: "unsorted", label: "Not in a list", blurb: "Friends you haven't put in any list." },
  { key: "archived", label: "Archived", blurb: "Friendships you archived. Only you know." },
] as const;
export type SmartListKey = (typeof SMART_LISTS)[number]["key"];

/** Does this person belong in that smart list? `online` needs the live set, passed in. */
export function inSmartList(key: SmartListKey, p: DirectoryPerson, now: number, online: ReadonlySet<string> = new Set()): boolean {
  switch (key) {
    case "friends":
      return p.friend && !p.archived;
    case "followers":
      return p.follower;
    case "following":
      return p.following;
    case "mutual":
      return p.following && p.follower && !p.friend;
    case "favorites":
      return p.favorite && p.friend;
    case "new_friends":
      return isNewFriend(p, now) && !p.archived;
    case "online":
      return online.has(p.id);
    case "verified":
      return p.verified;
    case "creators":
      return isCreator(p);
    case "businesses":
      return isBusiness(p);
    case "unsorted":
      return p.friend && !p.archived && p.listIds.length === 0;
    case "archived":
      return p.archived;
  }
}

// ─── List automation ─────────────────────────────────────────────────────────

export const RULE_KINDS = ["creator", "business", "verified", "favorite", "new_friend", "tag", "mutual_follow"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_LABEL: Record<RuleKind, string> = {
  creator: "Is a creator",
  business: "Is a business",
  verified: "Is verified",
  favorite: "Is a favourite",
  new_friend: "Became a friend this month",
  tag: "Has the tag",
  mutual_follow: "You follow each other",
};

export function isRuleKind(v: unknown): v is RuleKind {
  return typeof v === "string" && (RULE_KINDS as readonly string[]).includes(v);
}

export function ruleMatches(r: Pick<ListRule, "rule" | "value">, p: DirectoryPerson, now: number): boolean {
  switch (r.rule) {
    case "creator":
      return isCreator(p);
    case "business":
      return isBusiness(p);
    case "verified":
      return p.verified;
    case "favorite":
      return p.favorite && p.friend;
    case "new_friend":
      return isNewFriend(p, now);
    case "tag":
      return !!r.value && p.tags.some((t) => t.toLowerCase() === r.value!.toLowerCase());
    case "mutual_follow":
      return p.following && p.follower;
  }
}

/** For each list with rules: the people who match any rule and are not in it yet. Archived friendships are left out. */
export function ruleCandidates(rules: readonly ListRule[], people: readonly DirectoryPerson[], now: number): Map<string, string[]> {
  const byList = new Map<string, ListRule[]>();
  for (const r of rules) byList.set(r.circleId, [...(byList.get(r.circleId) ?? []), r]);
  const out = new Map<string, string[]>();
  for (const [listId, rs] of byList) {
    const ids = people.filter((p) => !p.archived && !p.listIds.includes(listId) && rs.some((r) => ruleMatches(r, p, now))).map((p) => p.id);
    if (ids.length) out.set(listId, ids);
  }
  return out;
}

// ─── Nesting ─────────────────────────────────────────────────────────────────

/** Lists in tree order with their depth (0 = top). An orphan (parent missing) shows at the top. */
export function listTree(lists: readonly ListNode[]): { list: ListNode; depth: number }[] {
  const ids = new Set(lists.map((l) => l.id));
  const children = new Map<string | null, ListNode[]>();
  for (const l of lists) {
    const parent = l.parentId && ids.has(l.parentId) && l.parentId !== l.id ? l.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), l]);
  }
  const out: { list: ListNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const l of children.get(parent) ?? []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push({ list: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  // a cycle in bad data would hide lists: show anything not reached at the top
  for (const l of lists) if (!seen.has(l.id)) out.push({ list: l, depth: 0 });
  return out;
}

/** Can `listId` move under `parentId`? Never into itself or its own descendants, never deeper than four levels. */
export function canNest(lists: readonly ListNode[], listId: string, parentId: string | null): { ok: true } | { ok: false; error: string } {
  if (!parentId) return { ok: true };
  if (parentId === listId) return { ok: false, error: "A list can't sit inside itself." };
  const byId = new Map(lists.map((l) => [l.id, l]));
  if (!byId.has(parentId)) return { ok: false, error: "Choose one of your lists." };
  // parent's level (1 = top)
  let level = 1;
  for (let cur = byId.get(parentId)?.parentId ?? null, guard = 0; cur && guard < 10; cur = byId.get(cur)?.parentId ?? null, guard++) {
    if (cur === listId) return { ok: false, error: "A list can't sit inside one of its own lists." };
    level++;
  }
  // height of the moved subtree (1 = no children)
  const height = (id: string, guard = 0): number => (guard > 10 ? 1 : 1 + Math.max(0, ...lists.filter((l) => l.parentId === id).map((l) => (l.id === parentId ? 99 : height(l.id, guard + 1)))));
  const h = height(listId);
  if (h >= 99) return { ok: false, error: "A list can't sit inside one of its own lists." };
  if (level + h > MAX_LIST_DEPTH) return { ok: false, error: `Lists nest up to ${MAX_LIST_DEPTH} levels.` };
  return { ok: true };
}

// ─── AI Organization Engine™ ─────────────────────────────────────────────────

export type OrgSuggestion =
  | { id: string; kind: "merge"; title: string; line: string; from: string; into: string }
  | { id: string; kind: "archive_empty"; title: string; line: string; listId: string }
  | { id: string; kind: "apply_rules"; title: string; line: string; listId: string; ids: string[] }
  | { id: string; kind: "sort_unsorted"; title: string; line: string; count: number }
  | { id: string; kind: "sub_list"; title: string; line: string; listId: string; ids: string[]; name: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function organizationSuggestions(input: { lists: readonly ListNode[]; people: readonly DirectoryPerson[]; rules: readonly ListRule[]; now: number }): OrgSuggestion[] {
  const { lists, people, rules, now } = input;
  const out: OrgSuggestion[] = [];
  const live = lists.filter((l) => !l.archived);
  const members = new Map<string, Set<string>>();
  for (const p of people) for (const id of p.listIds) members.set(id, (members.get(id) ?? new Set()).add(p.id));

  // 1. rules with people waiting
  for (const [listId, ids] of ruleCandidates(rules, people, now)) {
    const l = live.find((x) => x.id === listId);
    if (l) out.push({ id: `rules-${listId}`, kind: "apply_rules", title: `Add ${plural(ids.length, "person", "people")} to ${l.name}`, line: "They match the rules you set for this list.", listId, ids });
  }

  // 2. two custom lists with nearly the same people
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.kind !== "custom" || b.kind !== "custom") continue;
      const A = members.get(a.id) ?? new Set();
      const B = members.get(b.id) ?? new Set();
      if (A.size < 3 || B.size < 3) continue;
      let both = 0;
      for (const id of A) if (B.has(id)) both++;
      if (both / (A.size + B.size - both) >= 0.8) {
        const [from, into] = A.size <= B.size ? [a, b] : [b, a];
        out.push({ id: `merge-${from.id}-${into.id}`, kind: "merge", title: `Merge ${from.name} into ${into.name}?`, line: "They hold almost the same people. The smaller list is archived, not deleted, so you can undo it.", from: from.id, into: into.id });
      }
    }
  }

  // 3. a big list mixing in creators or businesses, with no sub-list yet
  for (const l of live) {
    const ms = people.filter((p) => members.get(l.id)?.has(p.id));
    if (ms.length < 30 || live.some((x) => x.parentId === l.id)) continue;
    const creators = ms.filter(isCreator);
    const businesses = ms.filter(isBusiness);
    const pick = creators.length >= businesses.length ? { who: creators, name: "Creators" } : { who: businesses, name: "Businesses" };
    if (pick.who.length >= 10) out.push({ id: `sub-${l.id}`, kind: "sub_list", title: `Split the ${pick.name.toLowerCase()} out of ${l.name}?`, line: `A ${pick.name} list inside ${l.name}, with ${plural(pick.who.length, "person", "people")}. Nobody leaves ${l.name}.`, listId: l.id, ids: pick.who.map((p) => p.id), name: pick.name });
  }

  // 4. an empty list nobody has used in a month
  for (const l of live) {
    if (l.kind !== "custom" || l.memberCount > 0 || !l.createdAt || now - Date.parse(l.createdAt) < 30 * DAY) continue;
    out.push({ id: `empty-${l.id}`, kind: "archive_empty", title: `Archive ${l.name}?`, line: "It has been empty for a month. Archiving keeps it, out of the way.", listId: l.id });
  }

  // 5. friends in no list at all
  const unsorted = people.filter((p) => inSmartList("unsorted", p, now)).length;
  if (unsorted >= 10 && live.length > 0) out.push({ id: "unsorted", kind: "sort_unsorted", title: `${plural(unsorted, "friend isn't", "friends aren't")} in any list`, line: "Show them, and sort a few at a time.", count: unsorted });

  return out.slice(0, 5);
}

// ─── List Analytics™ (private) ───────────────────────────────────────────────

export interface ListInsight {
  key: "largest" | "most_active" | "quiet" | "growing";
  title: string;
  listId: string;
  line: string;
}

/** A few plain sentences about the member's own lists. `addedAt` = when each membership was made, by list. */
export function listInsights(lists: readonly ListNode[], people: readonly DirectoryPerson[], addedAt: ReadonlyMap<string, readonly string[]>, now: number): ListInsight[] {
  const live = lists.filter((l) => !l.archived && l.memberCount > 0);
  if (!live.length) return [];
  const out: ListInsight[] = [];
  const largest = [...live].sort((a, b) => b.memberCount - a.memberCount)[0]!;
  out.push({ key: "largest", title: "Largest list", listId: largest.id, line: `${largest.name}, with ${plural(largest.memberCount, "person", "people")}.` });

  const talked = (l: ListNode) => people.filter((p) => p.listIds.includes(l.id) && (p.recentMessages ?? 0) > 0).length;
  const known = people.some((p) => p.recentMessages !== null);
  if (known) {
    const active = [...live].map((l) => [l, talked(l)] as const).sort((a, b) => b[1] - a[1]);
    if (active[0] && active[0][1] > 0) out.push({ key: "most_active", title: "Where you talk most", listId: active[0][0].id, line: `You've chatted with ${plural(active[0][1], "person", "people")} in ${active[0][0].name} lately.` });
    const quiet = active.filter(([l, n]) => n === 0 && l.memberCount >= 3);
    if (quiet[0]) out.push({ key: "quiet", title: "Quiet list", listId: quiet[0][0].id, line: `Nobody in ${quiet[0][0].name} has chatted with you in three months.` });
  }

  const month = now - 30 * DAY;
  const growing = [...live].map((l) => [l, (addedAt.get(l.id) ?? []).filter((t) => Date.parse(t) >= month).length] as const).sort((a, b) => b[1] - a[1]);
  if (growing[0] && growing[0][1] >= 2) out.push({ key: "growing", title: "Growing list", listId: growing[0][0].id, line: `${plural(growing[0][1], "person", "people")} added to ${growing[0][0].name} this month.` });
  return out;
}

// ─── Search and filters ──────────────────────────────────────────────────────

export interface PeopleFilter {
  q: string;
  smart: SmartListKey | null;
  listId: string | null;
  tag: string | null;
}

/** Name, handle, label and tags, case- and accent-insensitive. */
export function searchPeople(people: readonly DirectoryPerson[], f: PeopleFilter, now: number, online: ReadonlySet<string> = new Set()): DirectoryPerson[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(f.q.trim().replace(/^@/, ""));
  return people.filter((p) => {
    if (f.smart && !inSmartList(f.smart, p, now, online)) return false;
    if (f.listId && !p.listIds.includes(f.listId)) return false;
    if (f.tag && !p.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
    if (!q) return true;
    return [p.displayName, p.handle, p.label ?? "", ...p.tags].some((s) => norm(s).includes(q));
  });
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export function validateTag(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.replace(/\s+/g, " ").trim().replace(/^#/, "");
  if (!v) return { ok: false, error: "Type a tag." };
  if (v.length > MAX_TAG_LENGTH) return { ok: false, error: `Keep tags under ${MAX_TAG_LENGTH} characters.` };
  // a tag is a word, never markup or a link
  if (/[<>]|https?:\/\//i.test(v)) return { ok: false, error: "Tags are plain words." };
  return { ok: true, value: v };
}

/** Every tag the member uses, most used first. */
export function tagCounts(people: readonly DirectoryPerson[]): { tag: string; count: number }[] {
  const m = new Map<string, { tag: string; count: number }>();
  for (const p of people)
    for (const t of p.tags) {
      const k = t.toLowerCase();
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { tag: t, count: 1 });
    }
  return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ─── Import and export ───────────────────────────────────────────────────────

/** A CSV cell, quoted, and never a spreadsheet formula (=, +, -, @ are prefixed). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportCsv(people: readonly DirectoryPerson[], lists: readonly ListNode[]): string {
  const name = new Map(lists.map((l) => [l.id, l.name]));
  const rows = [["handle", "name", "relationship", "label", "tags", "lists"].map(csvCell).join(",")];
  for (const p of people) {
    const rel = [p.friend && "friend", p.following && "following", p.follower && "follower"].filter(Boolean).join(" ");
    rows.push([`@${p.handle}`, p.displayName, rel, p.label ?? "", p.tags.join("; "), p.listIds.map((id) => name.get(id) ?? "").filter(Boolean).join("; ")].map(csvCell).join(","));
  }
  return rows.join("\r\n");
}

/** Handles from a pasted list or a CSV's first column: "@ada", "ada", "https://…/@ada". At most 500, de-duplicated. */
export function parseHandles(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const first = (line.split(",")[0] ?? "").trim().replace(/^"|"$/g, "").replace(/^'/, "");
    const m = /(?:^|\/)@?([a-z0-9_.]{2,30})\/?$/i.exec(first);
    if (m && m[1]!.toLowerCase() !== "handle") out.add(m[1]!.toLowerCase());
    if (out.size >= 500) break;
  }
  return [...out];
}
