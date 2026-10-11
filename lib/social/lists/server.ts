import "server-only";

import { MAX_CIRCLES_PER_MEMBER, MAX_MEMBERS_PER_CIRCLE, validateCircleName } from "@/lib/social/graph/circles";
import { labelDisplay } from "@/lib/social/graph/labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

import {
  canNest,
  isRuleKind,
  MAX_RULES_PER_LIST,
  MAX_TAGS_PER_PERSON,
  ruleCandidates,
  validateTag,
  type DirectoryPerson,
  type ListNode,
  type ListRule,
} from "./engine";

/**
 * The Relationship Manager™ read and its writes (Feature 19 · Part 10).
 *
 * ── One directory, every relationship ─────────────────────────────────────
 * Friends, people you follow and people who follow you, merged into ONE row
 * per person with their flags, your private label, tags and lists. A fixed
 * number of queries however large the network (each list paginated past
 * PostgREST's silent 1,000-row ceiling), so a member with 2,000 connections
 * costs the same round trips as one with 20.
 *
 * ── Only people you are connected to ──────────────────────────────────────
 * Every write that names people checks they are a friend, someone you follow
 * or a follower, and not blocked either way. A private list or tag on someone
 * you have no relationship with would be a quiet dossier.
 *
 * ── Undo ──────────────────────────────────────────────────────────────────
 * Every bulk write returns exactly what it changed (who was added, removed,
 * tagged), so the page can reverse it with the opposite action. Nothing is
 * deleted that an undo could not put back: a merge archives the old list.
 */

export const DIRECTORY_CAP = 3000;
type Db = ReturnType<typeof createAdminClient>;

export interface RelationshipDirectory {
  people: DirectoryPerson[];
  lists: ListNode[];
  rules: ListRule[];
  /** membership timestamps per list, for "growing list" */
  addedAt: Record<string, string[]>;
  /** true when the network is larger than the directory shows */
  capped: boolean;
  ready: { nesting: boolean; tags: boolean; rules: boolean };
}

async function loadLists(db: Db, userId: string): Promise<{ lists: ListNode[]; nesting: boolean }> {
  const full = await db.from("social_circles").select("id, name, color, icon, kind, position, parent_id, archived_at, description, created_at").eq("owner_id", userId).order("position").order("created_at").limit(MAX_CIRCLES_PER_MEMBER);
  type R = Record<string, unknown>;
  const map = (r: R, nesting: boolean): ListNode => ({
    id: r.id as string,
    name: (r.name as string) ?? "List",
    color: (r.color as string) ?? "blue",
    icon: (r.icon as string) ?? "circle",
    kind: (r.kind as string) ?? "custom",
    memberCount: 0,
    parentId: nesting ? ((r.parent_id as string | null) ?? null) : null,
    archived: nesting ? !!r.archived_at : false,
    description: nesting ? ((r.description as string | null) ?? null) : null,
    createdAt: (r.created_at as string | null) ?? null,
  });
  if (!full.error) return { lists: ((full.data ?? []) as R[]).map((r) => map(r, true)), nesting: true };
  // before 0225 (and before 0217): the columns that exist
  const mid = await db.from("social_circles").select("id, name, color, icon, kind, position, created_at").eq("owner_id", userId).order("position").order("created_at").limit(MAX_CIRCLES_PER_MEMBER);
  if (!mid.error) return { lists: ((mid.data ?? []) as R[]).map((r) => map(r, false)), nesting: false };
  const base = await db.from("social_circles").select("id, name, color, position, created_at").eq("owner_id", userId).order("position").order("created_at").limit(MAX_CIRCLES_PER_MEMBER);
  return { lists: ((base.data ?? []) as R[]).map((r) => map(r, false)), nesting: false };
}

export async function relationshipDirectory(userId: string): Promise<RelationshipDirectory> {
  const db = createAdminClient();
  type FR = { user_low: string; user_high: string; created_at: string };
  type FL = { follower_id: string; following_id: string; created_at: string };
  const [friendsR, followingR, followersR, blocksR, favR, labelsR, tagsR, membersR, listsR, rulesR, prefsR, activityR] = await Promise.all([
    paginatedSelect<FR>((from, to) => db.from("friendships").select("user_low, user_high, created_at").or(`user_low.eq.${userId},user_high.eq.${userId}`).order("created_at").range(from, to), DIRECTORY_CAP),
    paginatedSelect<FL>((from, to) => db.from("follows").select("follower_id, following_id, created_at").eq("follower_id", userId).order("created_at").range(from, to), DIRECTORY_CAP),
    paginatedSelect<FL>((from, to) => db.from("follows").select("follower_id, following_id, created_at").eq("following_id", userId).order("created_at").range(from, to), DIRECTORY_CAP),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`).limit(1000),
    db.from("friend_favorites").select("friend_id").eq("user_id", userId).limit(1000),
    db.from("relationship_labels").select("subject_id, label").eq("owner_id", userId).limit(1000),
    paginatedSelect<{ subject_id: string; tag: string }>((from, to) => db.from("relationship_tags").select("subject_id, tag").eq("owner_id", userId).order("created_at").range(from, to), 20_000),
    paginatedSelect<{ circle_id: string; member_id: string; added_at: string }>((from, to) => db.from("circle_members").select("circle_id, member_id, added_at").eq("owner_id", userId).order("added_at").range(from, to), MAX_CIRCLES_PER_MEMBER * MAX_MEMBERS_PER_CIRCLE),
    loadLists(db, userId),
    db.from("circle_rules").select("id, circle_id, rule, value").eq("owner_id", userId).limit(500),
    db.from("relationship_prefs").select("friend_id").eq("owner_id", userId).not("archived_at", "is", null).limit(3000),
    db.rpc("relationship_activity", { p_viewer: userId }),
  ]);

  const blocked = new Set<string>();
  for (const b of (blocksR.data ?? []) as { blocker_id: string; blocked_id: string }[]) blocked.add(b.blocker_id === userId ? b.blocked_id : b.blocker_id);

  type Edge = { friend: boolean; following: boolean; follower: boolean; since: string | null };
  const edges = new Map<string, Edge>();
  const edge = (id: string) => {
    let e = edges.get(id);
    if (!e) edges.set(id, (e = { friend: false, following: false, follower: false, since: null }));
    return e;
  };
  const earlier = (a: string | null, b: string) => (!a || b < a ? b : a);
  for (const f of friendsR.rows) {
    const other = f.user_low === userId ? f.user_high : f.user_low;
    const e = edge(other);
    e.friend = true;
    e.since = f.created_at;
  }
  for (const f of followingR.rows) {
    const e = edge(f.following_id);
    e.following = true;
    if (!e.friend) e.since = earlier(e.since, f.created_at);
  }
  for (const f of followersR.rows) {
    const e = edge(f.follower_id);
    e.follower = true;
    if (!e.friend) e.since = earlier(e.since, f.created_at);
  }
  for (const id of blocked) edges.delete(id);
  edges.delete(userId);

  // friends first, so a capped directory keeps the closest relationships
  let ids = [...edges.keys()].sort((a, b) => Number(edges.get(b)!.friend) - Number(edges.get(a)!.friend));
  const capped = ids.length > DIRECTORY_CAP || friendsR.capped || followingR.capped || followersR.capped;
  ids = ids.slice(0, DIRECTORY_CAP);

  type P = { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_verified: boolean | null; profile_type: string | null };
  const profiles = new Map<string, P>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  await Promise.all(
    chunks.map(async (chunk) => {
      const { data } = await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, profile_type").in("id", chunk);
      for (const p of (data ?? []) as P[]) profiles.set(p.id, p);
    }),
  );

  const fav = new Set(((favR.data ?? []) as { friend_id: string }[]).map((r) => r.friend_id));
  const labels = new Map(((labelsR.data ?? []) as { subject_id: string; label: string }[]).map((r) => [r.subject_id, labelDisplay(r.label)]));
  const tags = new Map<string, string[]>();
  for (const t of tagsR.rows) tags.set(t.subject_id, [...(tags.get(t.subject_id) ?? []), t.tag]);
  const memberOf = new Map<string, string[]>();
  const addedAt: Record<string, string[]> = {};
  const counts = new Map<string, number>();
  for (const m of membersR.rows) {
    memberOf.set(m.member_id, [...(memberOf.get(m.member_id) ?? []), m.circle_id]);
    (addedAt[m.circle_id] ??= []).push(m.added_at);
    counts.set(m.circle_id, (counts.get(m.circle_id) ?? 0) + 1);
  }
  const archived = new Set(((prefsR.data ?? []) as { friend_id: string }[]).map((r) => r.friend_id));
  const activity = activityR.error ? null : new Map(((activityR.data ?? []) as { friend_id: string; msgs_90: number }[]).map((r) => [r.friend_id, r.msgs_90]));

  const people: DirectoryPerson[] = [];
  for (const id of ids) {
    const p = profiles.get(id);
    if (!p?.handle) continue;
    const e = edges.get(id)!;
    people.push({
      id,
      handle: p.handle,
      displayName: p.display_name || `@${p.handle}`,
      avatarUrl: p.avatar_url,
      verified: !!p.is_verified,
      profileType: p.profile_type ?? "personal",
      friend: e.friend,
      following: e.following,
      follower: e.follower,
      favorite: e.friend && fav.has(id),
      archived: e.friend && archived.has(id),
      since: e.since,
      label: labels.get(id) ?? null,
      tags: tags.get(id) ?? [],
      listIds: memberOf.get(id) ?? [],
      recentMessages: activity ? (activity.get(id) ?? 0) : null,
    });
  }
  people.sort((a, b) => Number(b.friend) - Number(a.friend) || a.displayName.localeCompare(b.displayName));

  const rules: ListRule[] = rulesR.error ? [] : ((rulesR.data ?? []) as { id: string; circle_id: string; rule: string; value: string | null }[]).filter((r) => isRuleKind(r.rule)).map((r) => ({ id: r.id, circleId: r.circle_id, rule: r.rule as ListRule["rule"], value: r.value }));

  return {
    people,
    lists: listsR.lists.map((l) => ({ ...l, memberCount: counts.get(l.id) ?? 0 })),
    rules,
    addedAt,
    capped,
    ready: { nesting: listsR.nesting, tags: !tagsR.error, rules: !rulesR.error },
  };
}

// ─── Who may a write name? ───────────────────────────────────────────────────

/** The subset of `ids` the member is connected to (friend, following, follower) and not blocked with. Fails closed. */
export async function connectedSubset(userId: string, ids: readonly string[]): Promise<{ connected: Set<string>; friends: Set<string> }> {
  const want = [...new Set(ids)].filter((id) => id !== userId).slice(0, 500);
  const connected = new Set<string>();
  const friends = new Set<string>();
  if (!want.length) return { connected, friends };
  const db = createAdminClient();
  try {
    const [f1, f2, fo1, fo2, bl1, bl2] = await Promise.all([
      db.from("friendships").select("user_high").eq("user_low", userId).in("user_high", want),
      db.from("friendships").select("user_low").eq("user_high", userId).in("user_low", want),
      db.from("follows").select("following_id").eq("follower_id", userId).in("following_id", want),
      db.from("follows").select("follower_id").eq("following_id", userId).in("follower_id", want),
      db.from("blocks").select("blocked_id").eq("blocker_id", userId).in("blocked_id", want),
      db.from("blocks").select("blocker_id").eq("blocked_id", userId).in("blocker_id", want),
    ]);
    if ([f1, f2, fo1, fo2, bl1, bl2].some((r) => r.error)) return { connected, friends };
    for (const r of (f1.data ?? []) as { user_high: string }[]) friends.add(r.user_high);
    for (const r of (f2.data ?? []) as { user_low: string }[]) friends.add(r.user_low);
    for (const id of friends) connected.add(id);
    for (const r of (fo1.data ?? []) as { following_id: string }[]) connected.add(r.following_id);
    for (const r of (fo2.data ?? []) as { follower_id: string }[]) connected.add(r.follower_id);
    for (const r of (bl1.data ?? []) as { blocked_id: string }[]) {
      connected.delete(r.blocked_id);
      friends.delete(r.blocked_id);
    }
    for (const r of (bl2.data ?? []) as { blocker_id: string }[]) {
      connected.delete(r.blocker_id);
      friends.delete(r.blocker_id);
    }
  } catch {
    connected.clear();
    friends.clear();
  }
  return { connected, friends };
}

async function ownList(db: Db, userId: string, listId: string): Promise<{ id: string; name: string; archived: boolean } | null> {
  const { data, error } = await db.from("social_circles").select("id, name, archived_at").eq("id", listId).eq("owner_id", userId).maybeSingle();
  if (error) {
    // before 0225 there is no archived_at
    const base = await db.from("social_circles").select("id, name").eq("id", listId).eq("owner_id", userId).maybeSingle();
    return base.data ? { ...(base.data as { id: string; name: string }), archived: false } : null;
  }
  return data ? { id: (data as { id: string }).id, name: (data as { name: string }).name, archived: !!(data as { archived_at: string | null }).archived_at } : null;
}

// ─── Bulk management ─────────────────────────────────────────────────────────

export type BulkAction = "add_to_list" | "remove_from_list" | "tag" | "untag" | "favorite" | "unfavorite" | "archive" | "unarchive";
export type BulkResult = { ok: true; changed: string[]; note?: string } | { ok: false; error: string; status: number };

const missingTable = (msg: string) => /schema cache|does not exist|column/i.test(msg);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function bulkApply(userId: string, action: BulkAction, ids: readonly string[], opts: { listId?: string; tag?: string } = {}): Promise<BulkResult> {
  const db = createAdminClient();
  const { connected, friends } = await connectedSubset(userId, ids);
  const target = [...connected];
  if (!target.length) return { ok: true, changed: [], note: "Nobody here is one of your connections." };

  if (action === "add_to_list" || action === "remove_from_list") {
    const list = opts.listId ? await ownList(db, userId, opts.listId) : null;
    if (!list) return { ok: false, error: "Choose one of your lists.", status: 400 };
    const { data: existing } = await db.from("circle_members").select("member_id").eq("owner_id", userId).eq("circle_id", list.id).limit(MAX_MEMBERS_PER_CIRCLE + 1);
    const inList = new Set(((existing ?? []) as { member_id: string }[]).map((r) => r.member_id));
    if (action === "remove_from_list") {
      const gone = target.filter((id) => inList.has(id));
      if (!gone.length) return { ok: true, changed: [] };
      const { error } = await db.from("circle_members").delete().eq("owner_id", userId).eq("circle_id", list.id).in("member_id", gone);
      return error ? { ok: false, error: "Couldn't update the list.", status: 500 } : { ok: true, changed: gone };
    }
    if (list.archived) return { ok: false, error: "Restore the list first.", status: 400 };
    const add = target.filter((id) => !inList.has(id)).slice(0, Math.max(0, MAX_MEMBERS_PER_CIRCLE - inList.size));
    if (!add.length) return { ok: true, changed: [], note: inList.size >= MAX_MEMBERS_PER_CIRCLE ? `A list holds up to ${MAX_MEMBERS_PER_CIRCLE} people.` : undefined };
    const { error } = await db.from("circle_members").insert(add.map((member_id) => ({ circle_id: list.id, member_id, owner_id: userId })));
    return error ? { ok: false, error: "Couldn't update the list.", status: 500 } : { ok: true, changed: add };
  }

  if (action === "tag" || action === "untag") {
    const v = validateTag(opts.tag ?? "");
    if (!v.ok) return { ok: false, error: v.error, status: 400 };
    const { data: rows, error: readErr } = await db.from("relationship_tags").select("subject_id, tag").eq("owner_id", userId).in("subject_id", target);
    if (readErr) return { ok: false, error: missingTable(readErr.message) ? "Tags arrive with the next update." : "Couldn't save that.", status: missingTable(readErr.message) ? 503 : 500 };
    const has = new Map<string, string[]>();
    for (const r of (rows ?? []) as { subject_id: string; tag: string }[]) has.set(r.subject_id, [...(has.get(r.subject_id) ?? []), r.tag.toLowerCase()]);
    if (action === "untag") {
      const gone = target.filter((id) => has.get(id)?.includes(v.value.toLowerCase()));
      if (!gone.length) return { ok: true, changed: [] };
      const { error } = await db.from("relationship_tags").delete().eq("owner_id", userId).in("subject_id", gone).ilike("tag", escapeLike(v.value));
      return error ? { ok: false, error: "Couldn't save that.", status: 500 } : { ok: true, changed: gone };
    }
    const add = target.filter((id) => !has.get(id)?.includes(v.value.toLowerCase()) && (has.get(id)?.length ?? 0) < MAX_TAGS_PER_PERSON);
    if (!add.length) return { ok: true, changed: [] };
    const { error } = await db.from("relationship_tags").insert(add.map((subject_id) => ({ owner_id: userId, subject_id, tag: v.value })));
    return error ? { ok: false, error: "Couldn't save that.", status: 500 } : { ok: true, changed: add, note: add.length < target.length ? `Some people already have ${MAX_TAGS_PER_PERSON} tags or this one.` : undefined };
  }

  // favourites and archive are about FRIENDS only
  const fr = target.filter((id) => friends.has(id));
  if (!fr.length) return { ok: true, changed: [], note: "Only friends can be favourites or archived." };
  if (action === "favorite" || action === "unfavorite") {
    const { data } = await db.from("friend_favorites").select("friend_id").eq("user_id", userId).in("friend_id", fr);
    const already = new Set(((data ?? []) as { friend_id: string }[]).map((r) => r.friend_id));
    if (action === "favorite") {
      const add = fr.filter((id) => !already.has(id));
      if (!add.length) return { ok: true, changed: [] };
      const { error } = await db.from("friend_favorites").insert(add.map((friend_id) => ({ user_id: userId, friend_id })));
      return error ? { ok: false, error: "Couldn't save that.", status: 500 } : { ok: true, changed: add };
    }
    const gone = fr.filter((id) => already.has(id));
    if (!gone.length) return { ok: true, changed: [] };
    const { error } = await db.from("friend_favorites").delete().eq("user_id", userId).in("friend_id", gone);
    return error ? { ok: false, error: "Couldn't save that.", status: 500 } : { ok: true, changed: gone };
  }
  // archive / unarchive (Part 8, 0223)
  const now = new Date().toISOString();
  const { data: prefs, error: prefErr } = await db.from("relationship_prefs").select("friend_id, archived_at").eq("owner_id", userId).in("friend_id", fr);
  if (prefErr) return { ok: false, error: missingTable(prefErr.message) ? "Archiving arrives with the next update." : "Couldn't save that.", status: missingTable(prefErr.message) ? 503 : 500 };
  const isArchived = new Set(((prefs ?? []) as { friend_id: string; archived_at: string | null }[]).filter((r) => r.archived_at).map((r) => r.friend_id));
  const change = fr.filter((id) => (action === "archive" ? !isArchived.has(id) : isArchived.has(id)));
  if (!change.length) return { ok: true, changed: [] };
  const { error } = await db.from("relationship_prefs").upsert(change.map((friend_id) => ({ owner_id: userId, friend_id, archived_at: action === "archive" ? now : null, updated_at: now })), { onConflict: "owner_id,friend_id" });
  return error ? { ok: false, error: "Couldn't save that.", status: 500 } : { ok: true, changed: change };
}

// ─── List operations ─────────────────────────────────────────────────────────

export type ListOpResult = { ok: true; id?: string; changed?: string[]; note?: string } | { ok: false; error: string; status: number };

export async function updateListMeta(userId: string, listId: string, patch: { parentId?: string | null; archived?: boolean; description?: string | null }): Promise<ListOpResult> {
  const db = createAdminClient();
  const { lists, nesting } = await loadLists(db, userId);
  if (!nesting) return { ok: false, error: "Nested and archived lists arrive with the next update.", status: 503 };
  if (!lists.some((l) => l.id === listId)) return { ok: false, error: "Choose one of your lists.", status: 404 };
  const cols: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.parentId !== undefined) {
    const ok = canNest(lists, listId, patch.parentId);
    if (!ok.ok) return { ok: false, error: ok.error, status: 400 };
    cols.parent_id = patch.parentId;
  }
  if (patch.archived !== undefined) cols.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.description !== undefined) {
    const d = patch.description?.replace(/\s+/g, " ").trim() || null;
    if (d && d.length > 140) return { ok: false, error: "Keep it under 140 characters.", status: 400 };
    cols.description = d;
  }
  const { error } = await db.from("social_circles").update(cols).eq("id", listId).eq("owner_id", userId);
  // the database trigger is the last word on nesting
  if (error) return { ok: false, error: /nest|inside/i.test(error.message) ? "That nesting isn't allowed." : "Couldn't save that.", status: /nest|inside/i.test(error.message) ? 400 : 500 };
  return { ok: true };
}

export async function addRule(userId: string, listId: string, rule: string, value: string | null): Promise<ListOpResult> {
  if (!isRuleKind(rule)) return { ok: false, error: "Unknown rule.", status: 400 };
  let v: string | null = null;
  if (rule === "tag") {
    const t = validateTag(value ?? "");
    if (!t.ok) return { ok: false, error: t.error, status: 400 };
    v = t.value;
  }
  const db = createAdminClient();
  if (!(await ownList(db, userId, listId))) return { ok: false, error: "Choose one of your lists.", status: 404 };
  const { count } = await db.from("circle_rules").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("circle_id", listId);
  if ((count ?? 0) >= MAX_RULES_PER_LIST) return { ok: false, error: `Up to ${MAX_RULES_PER_LIST} rules per list.`, status: 400 };
  const { data, error } = await db.from("circle_rules").insert({ owner_id: userId, circle_id: listId, rule, value: v }).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That rule is already there.", status: 400 };
    return { ok: false, error: missingTable(error.message) ? "Rules arrive with the next update." : "Couldn't save that.", status: missingTable(error.message) ? 503 : 500 };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeRule(userId: string, ruleId: string): Promise<ListOpResult> {
  const { error } = await createAdminClient().from("circle_rules").delete().eq("id", ruleId).eq("owner_id", userId);
  return error ? { ok: false, error: "Couldn't remove that.", status: 500 } : { ok: true };
}

/** Add everyone the list's rules match. Computed from the same directory the page shows. */
export async function applyRules(userId: string, listId: string): Promise<ListOpResult> {
  const dir = await relationshipDirectory(userId);
  const ids = ruleCandidates(dir.rules.filter((r) => r.circleId === listId), dir.people, Date.now()).get(listId) ?? [];
  if (!ids.length) return { ok: true, changed: [] };
  const out = await bulkApply(userId, "add_to_list", ids, { listId });
  return out.ok ? { ok: true, changed: out.changed, note: out.note } : out;
}

/** Merge: everyone in `from` joins `into`, and `from` is ARCHIVED (so an undo can restore it). */
export async function mergeLists(userId: string, from: string, into: string): Promise<ListOpResult> {
  if (from === into) return { ok: false, error: "Choose two different lists.", status: 400 };
  const db = createAdminClient();
  const [a, b] = await Promise.all([ownList(db, userId, from), ownList(db, userId, into)]);
  if (!a || !b) return { ok: false, error: "Choose two of your lists.", status: 404 };
  const { data } = await db.from("circle_members").select("member_id").eq("owner_id", userId).eq("circle_id", from).limit(MAX_MEMBERS_PER_CIRCLE);
  const ids = ((data ?? []) as { member_id: string }[]).map((r) => r.member_id);
  const added = ids.length ? await bulkApply(userId, "add_to_list", ids, { listId: into }) : ({ ok: true, changed: [] } as BulkResult);
  if (!added.ok) return added;
  const arch = await updateListMeta(userId, from, { archived: true });
  if (!arch.ok) return arch;
  return { ok: true, changed: added.changed };
}

/** A new list INSIDE another one, with these people (the "split" suggestion). */
export async function createSubList(userId: string, parentId: string, name: string, ids: readonly string[]): Promise<ListOpResult> {
  const db = createAdminClient();
  const { lists, nesting } = await loadLists(db, userId);
  if (!nesting) return { ok: false, error: "Nested lists arrive with the next update.", status: 503 };
  if (lists.length >= MAX_CIRCLES_PER_MEMBER) return { ok: false, error: `You can have up to ${MAX_CIRCLES_PER_MEMBER} lists.`, status: 400 };
  const n = validateCircleName(name, lists.map((l) => l.name));
  if (!n.ok) return { ok: false, error: n.error, status: 400 };
  const nest = canNest([...lists, { id: "__new__", name: n.value, color: "blue", icon: "circle", kind: "custom", memberCount: 0, parentId: null, archived: false, description: null, createdAt: null }], "__new__", parentId);
  if (!nest.ok) return { ok: false, error: nest.error, status: 400 };
  const parent = lists.find((l) => l.id === parentId)!;
  const { data, error } = await db.from("social_circles").insert({ owner_id: userId, name: n.value, color: parent.color, parent_id: parentId, position: lists.length }).select("id").single();
  if (error) return { ok: false, error: "Couldn't create the list.", status: 500 };
  const id = (data as { id: string }).id;
  const added = await bulkApply(userId, "add_to_list", ids, { listId: id });
  return { ok: true, id, changed: added.ok ? added.changed : [] };
}

/** Import handles into a list. Only people you are connected to are added; the rest are named back. */
export async function importHandles(userId: string, listId: string, handles: readonly string[]): Promise<ListOpResult & { skipped?: string[] }> {
  const db = createAdminClient();
  const want = [...new Set(handles.map((h) => h.toLowerCase()))].slice(0, 500);
  if (!want.length) return { ok: false, error: "No handles found.", status: 400 };
  const found = new Map<string, string>();
  for (let i = 0; i < want.length; i += 200) {
    const { data } = await db.from("profiles").select("id, handle").in("handle", want.slice(i, i + 200));
    for (const p of (data ?? []) as { id: string; handle: string }[]) found.set(p.handle.toLowerCase(), p.id);
  }
  const ids = [...found.values()];
  const out = await bulkApply(userId, "add_to_list", ids, { listId });
  if (!out.ok) return out;
  const { connected } = await connectedSubset(userId, ids);
  const skipped = want.filter((h) => !found.has(h) || !connected.has(found.get(h)!));
  return { ok: true, changed: out.changed, note: out.note, skipped };
}
