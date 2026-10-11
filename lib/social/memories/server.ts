import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  canViewMemory,
  findDuplicates,
  importantMoments,
  isMemoryCategory,
  matchesQuery,
  memoryInsights,
  onThisDay,
  parseMemoryQuery,
  suggestCategory,
  suggestCollections,
  validateMemory,
  type CollectionSuggestion,
  type MemoryCategory,
  type MemoryInsights,
  type MemoryLite,
  type MemoryVisibility,
  type SourceKind,
} from "./engine";

/**
 * Shared Memories™ — reads and writes (Feature 19 · Part 14, 0229).
 *
 * Every read is the owner's own rows, or a memory whose visibility lets this
 * viewer see it (engine.canViewMemory, with the viewer's friendship, circles and
 * blocks read here — never claimed by a browser). Tagging is limited to friends,
 * so a memory can never be used to put a stranger's name on something.
 *
 * The Shared Memory Engine proposes memories from moments other tables already own
 * (friendships, first conversations, accepted collaborations, professional
 * connections and recommendations, memberships, opened capsules, the first post).
 * A proposal is stored only when the member keeps it.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const TRASH_DAYS = 30;
const MAX_MEMORIES = 1000;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

export interface PersonLite {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface Memory extends MemoryLite {
  ownerId: string;
  feeling: string | null;
  linkUrl: string | null;
  visibility: MemoryVisibility;
  circleId: string | null;
  version: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  people: PersonLite[];
  media: { kind: "post" | "image" | "video" | "link"; postId: string | null; url: string | null }[];
}

async function people(db: ReturnType<typeof createAdminClient>, ids: readonly string[]): Promise<Map<string, PersonLite>> {
  if (!ids.length) return new Map();
  const { data } = await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", [...new Set(ids)].slice(0, 1000));
  return new Map(((data ?? []) as Row[]).filter((p) => p.handle).map((p) => [p.id as string, { id: p.id as string, handle: p.handle as string, name: ((p.display_name as string) || `@${p.handle as string}`).slice(0, 60), avatarUrl: (p.avatar_url as string | null) ?? null }]));
}

function toMemory(r: Row, who: Map<string, PersonLite>, peopleRows: Row[], mediaRows: Row[]): Memory {
  const media = mediaRows
    .filter((m) => m.memory_id === r.id)
    .sort((a, b) => Number(a.idx) - Number(b.idx))
    .map((m) => ({ kind: m.kind as Memory["media"][number]["kind"], postId: (m.post_id as string | null) ?? null, url: (m.url as string | null) ?? null }));
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    title: r.title as string,
    note: (r.note as string | null) ?? null,
    category: (isMemoryCategory(r.category) ? r.category : "friendship") as MemoryCategory,
    occurredOn: String(r.occurred_on).slice(0, 10),
    place: (r.place as string | null) ?? null,
    feeling: (r.feeling as string | null) ?? null,
    linkUrl: (r.link_url as string | null) ?? null,
    sourceKind: r.source_kind as SourceKind,
    sourceRef: (r.source_ref as string | null) ?? null,
    visibility: r.visibility as MemoryVisibility,
    circleId: (r.circle_id as string | null) ?? null,
    pinned: !!r.pinned,
    version: Number(r.version ?? 1),
    archivedAt: (r.archived_at as string | null) ?? null,
    deletedAt: (r.deleted_at as string | null) ?? null,
    createdAt: r.created_at as string,
    people: peopleRows.filter((p) => p.memory_id === r.id).map((p) => who.get(p.user_id as string)).filter((p): p is PersonLite => !!p),
    media,
    mediaUrls: media.map((m) => m.url ?? `post:${m.postId}`),
  };
}

async function hydrate(db: ReturnType<typeof createAdminClient>, rows: Row[]): Promise<Memory[]> {
  const ids = rows.map((r) => r.id as string);
  if (!ids.length) return [];
  const [p, m] = await Promise.all([db.from("memory_people").select("memory_id, user_id").in("memory_id", ids), db.from("memory_media").select("memory_id, idx, kind, post_id, url").in("memory_id", ids)]);
  const peopleRows = (p.data ?? []) as Row[];
  const who = await people(db, peopleRows.map((x) => x.user_id as string));
  return rows.map((r) => toMemory(r, who, peopleRows, (m.data ?? []) as Row[]));
}

const COLS = "id, owner_id, title, note, category, occurred_on, place, feeling, link_url, source_kind, source_ref, visibility, circle_id, pinned, version, archived_at, deleted_at, created_at";

// ─── The owner's library ─────────────────────────────────────────────────────

export interface MemoryLibrary {
  memories: Memory[];
  archived: number;
  trash: number;
  insights: MemoryInsights;
  important: { id: string; reasons: string[] }[];
  onThisDay: { id: string; yearsAgo: number }[];
  collectionSuggestions: CollectionSuggestion[];
  duplicates: { a: string; b: string; why: string }[];
  collections: { id: string; title: string; description: string | null; visibility: string; memoryIds: string[]; suggestionKey: string | null }[];
  ready: boolean;
  loadedAt: number;
}

export async function memoryLibrary(ownerId: string, today = new Date()): Promise<MemoryLibrary> {
  const db = createAdminClient();
  const [live, counts, colR, dismissR] = await Promise.all([
    db.from("memories").select(COLS).eq("owner_id", ownerId).is("deleted_at", null).is("archived_at", null).order("occurred_on", { ascending: false }).limit(MAX_MEMORIES),
    db.from("memories").select("archived_at, deleted_at").eq("owner_id", ownerId).or("archived_at.not.is.null,deleted_at.not.is.null").limit(MAX_MEMORIES),
    db.from("memory_collections").select("id, title, description, visibility, suggestion_key, memory_collection_items(memory_id)").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(200),
    db.from("memory_reminder_dismissals").select("key").eq("owner_id", ownerId).limit(2000),
  ]);
  if (live.error) return { memories: [], archived: 0, trash: 0, insights: memoryInsights([]), important: [], onThisDay: [], collectionSuggestions: [], duplicates: [], collections: [], ready: !MISSING(live.error.message), loadedAt: Date.now() };
  const memories = await hydrate(db, (live.data ?? []) as Row[]);
  const cRows = (counts.data ?? []) as Row[];
  const collections = ((colR.data ?? []) as Row[]).map((c) => ({ id: c.id as string, title: c.title as string, description: (c.description as string | null) ?? null, visibility: c.visibility as string, suggestionKey: (c.suggestion_key as string | null) ?? null, memoryIds: ((c.memory_collection_items as Row[] | null) ?? []).map((i) => i.memory_id as string) }));
  const dismissed = new Set(((dismissR.data ?? []) as Row[]).map((d) => d.key as string));
  const taken = new Set([...collections.map((c) => c.suggestionKey).filter((k): k is string => !!k), ...[...dismissed].filter((k) => k.startsWith("col:")).map((k) => k.slice(4))]);
  return {
    memories,
    archived: cRows.filter((r) => r.archived_at && !r.deleted_at).length,
    trash: cRows.filter((r) => r.deleted_at).length,
    insights: memoryInsights(memories),
    important: importantMoments(memories),
    onThisDay: onThisDay(memories, today).filter((o) => !dismissed.has(`otd:${o.id}:${today.toISOString().slice(0, 4)}`)),
    collectionSuggestions: suggestCollections(memories, taken),
    duplicates: findDuplicates(memories).filter((d) => !dismissed.has(`dup:${[d.a, d.b].sort().join("|")}`)),
    collections,
    ready: true,
    loadedAt: Date.now(),
  };
}

/** Natural-language search over the owner's memories: the parse is returned so the page can show what it understood. */
export async function searchMemories(ownerId: string, q: string): Promise<{ results: Memory[]; understood: ReturnType<typeof parseMemoryQuery> }> {
  const lib = await memoryLibrary(ownerId);
  const everyone = new Map<string, { id: string; name: string; handle: string }>();
  for (const m of lib.memories) for (const p of m.people) everyone.set(p.id, p);
  const understood = parseMemoryQuery(q.slice(0, 200), [...everyone.values()]);
  return { results: lib.memories.filter((m) => matchesQuery(m, understood)), understood };
}

export async function archivedAndTrash(ownerId: string): Promise<{ archived: Memory[]; trash: Memory[] }> {
  const db = createAdminClient();
  // the 30-day trash empties itself when it is looked at — no job runs for it
  await db.from("memories").delete().eq("owner_id", ownerId).lt("deleted_at", new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString());
  const { data } = await db.from("memories").select(COLS).eq("owner_id", ownerId).or("archived_at.not.is.null,deleted_at.not.is.null").order("updated_at", { ascending: false }).limit(300);
  const all = await hydrate(db, (data ?? []) as Row[]);
  return { archived: all.filter((m) => m.archivedAt && !m.deletedAt), trash: all.filter((m) => m.deletedAt) };
}

// ─── Shared Memory Engine: suggestions from real moments ─────────────────────

export interface MemorySuggestion {
  sourceKind: SourceKind;
  sourceRef: string;
  title: string;
  occurredOn: string;
  category: MemoryCategory;
  personId: string | null;
  person: PersonLite | null;
  why: string;
}

export async function memorySuggestions(ownerId: string, limit = 20): Promise<MemorySuggestion[]> {
  const db = createAdminClient();
  const or2 = (a: string, b: string) => `${a}.eq.${ownerId},${b}.eq.${ownerId}`;
  const [fr, conv, collab, pro, rec, mem, caps, firstPost, kept, dismissed] = await Promise.all([
    db.from("friendships").select("user_low, user_high, created_at").or(or2("user_low", "user_high")).order("created_at", { ascending: false }).limit(60),
    db.from("conversations").select("id, user_low, user_high, created_at").or(or2("user_low", "user_high")).order("created_at", { ascending: false }).limit(60),
    db.from("post_collaborators").select("post_id, user_id, invited_by, created_at, posts(title)").eq("status", "accepted").or(`user_id.eq.${ownerId},invited_by.eq.${ownerId}`).order("created_at", { ascending: false }).limit(40),
    db.from("pro_connections").select("id, requester_id, addressee_id, requester_role, addressee_role, responded_at, created_at").eq("status", "accepted").or(or2("requester_id", "addressee_id")).limit(40),
    db.from("pro_recommendations").select("id, author_id, decided_at, created_at").eq("subject_id", ownerId).eq("status", "accepted").limit(40),
    db.from("creator_memberships").select("id, creator_id, billing, joined_at").eq("member_id", ownerId).limit(40),
    db.from("time_capsules").select("id, title, user_id, recipient_id, unlock_at").or(`user_id.eq.${ownerId},recipient_id.eq.${ownerId}`).lte("unlock_at", new Date().toISOString()).limit(40),
    db.from("posts").select("id, title, created_at").eq("publisher_id", ownerId).order("created_at", { ascending: true }).limit(1),
    db.from("memories").select("source_kind, source_ref").eq("owner_id", ownerId).not("source_ref", "is", null).limit(MAX_MEMORIES),
    db.from("memory_reminder_dismissals").select("key").eq("owner_id", ownerId).like("key", "sugg:%").limit(2000),
  ]);
  if (kept.error && MISSING(kept.error.message)) return [];
  const other = (a: unknown, b: unknown) => (a === ownerId ? (b as string) : (a as string));
  const out: Omit<MemorySuggestion, "person">[] = [];
  const day = (iso: unknown) => String(iso ?? "").slice(0, 10);
  for (const f of (fr.data ?? []) as Row[]) out.push({ sourceKind: "friendship", sourceRef: `friend:${other(f.user_low, f.user_high)}`, title: "We became friends", occurredOn: day(f.created_at), category: "friendship", personId: other(f.user_low, f.user_high), why: "When your friendship started" });
  for (const c of (conv.data ?? []) as Row[]) if (c.user_low && c.user_high) out.push({ sourceKind: "first_message", sourceRef: `conv:${c.id as string}`, title: "Our first conversation", occurredOn: day(c.created_at), category: "friendship", personId: other(c.user_low, c.user_high), why: "When your chat began" });
  for (const c of (collab.data ?? []) as Row[]) {
    const title = ((c.posts as Row | null)?.title as string | null) ?? null;
    out.push({ sourceKind: "collaboration", sourceRef: `collab:${c.post_id as string}:${c.user_id as string}`, title: title ? `Collaborated on “${title.slice(0, 60)}”` : "Our first collaboration", occurredOn: day(c.created_at), category: "creator", personId: c.user_id === ownerId ? (c.invited_by as string) : (c.user_id as string), why: "An accepted collaboration" });
  }
  for (const p of (pro.data ?? []) as Row[]) out.push({ sourceKind: "pro_connection", sourceRef: `pro:${p.id as string}`, title: "Started working together", occurredOn: day(p.responded_at ?? p.created_at), category: "business", personId: other(p.requester_id, p.addressee_id), why: "A confirmed professional connection" });
  for (const r of (rec.data ?? []) as Row[]) out.push({ sourceKind: "recommendation", sourceRef: `rec:${r.id as string}`, title: "Received a recommendation", occurredOn: day(r.decided_at ?? r.created_at), category: "business", personId: r.author_id as string, why: "A recommendation you accepted" });
  for (const m of (mem.data ?? []) as Row[]) out.push({ sourceKind: "membership", sourceRef: `member:${m.id as string}`, title: m.billing === "sub" ? "Subscribed to their content" : "Joined their community", occurredOn: day(m.joined_at), category: "communities", personId: m.creator_id as string, why: "A membership you hold" });
  for (const c of (caps.data ?? []) as Row[]) out.push({ sourceKind: "capsule", sourceRef: `capsule:${c.id as string}`, title: `A time capsule opened: ${String(c.title).slice(0, 60)}`, occurredOn: day(c.unlock_at), category: "friendship", personId: c.user_id === ownerId ? ((c.recipient_id as string | null) ?? null) : (c.user_id as string), why: "A capsule that has opened" });
  const fp = ((firstPost.data ?? []) as Row[])[0];
  if (fp) out.push({ sourceKind: "first_post", sourceRef: `post:${fp.id as string}`, title: "My first post", occurredOn: day(fp.created_at), category: suggestCategory(String(fp.title ?? ""))?.category ?? "creator", personId: null, why: "Where your posting started" });

  const keptSet = new Set(((kept.data ?? []) as Row[]).map((k) => `${k.source_kind as string}|${k.source_ref as string}`));
  const dis = new Set(((dismissed.data ?? []) as Row[]).map((d) => (d.key as string).slice(5)));
  const fresh = out.filter((s) => s.occurredOn && !keptSet.has(`${s.sourceKind}|${s.sourceRef}`) && !dis.has(`${s.sourceKind}|${s.sourceRef}`)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  // a person who blocked or was blocked is never proposed
  const pids = [...new Set(fresh.map((s) => s.personId).filter((x): x is string => !!x))];
  const [who, blocks] = await Promise.all([people(db, pids), pids.length ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${ownerId},blocked_id.eq.${ownerId}`) : Promise.resolve({ data: [] })]);
  const blocked = new Set(((blocks.data ?? []) as Row[]).map((b) => (b.blocker_id === ownerId ? (b.blocked_id as string) : (b.blocker_id as string))));
  return fresh
    .filter((s) => !s.personId || (who.has(s.personId) && !blocked.has(s.personId)))
    .slice(0, limit)
    .map((s) => ({ ...s, person: s.personId ? (who.get(s.personId) ?? null) : null }));
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface MemoryInput {
  title: string;
  note?: string | null;
  category?: MemoryCategory;
  occurredOn?: string;
  place?: string | null;
  feeling?: string | null;
  linkUrl?: string | null;
  visibility?: MemoryVisibility;
  circleId?: string | null;
  pinned?: boolean;
  peopleIds?: string[];
  media?: { kind: "post" | "image" | "video" | "link"; postId?: string | null; url?: string | null }[];
}

/** Friends only can be put on a memory — never a stranger, never someone blocked. */
async function allowedPeople(db: ReturnType<typeof createAdminClient>, ownerId: string, ids: readonly string[]): Promise<string[] | null> {
  const want = [...new Set(ids)].filter((id) => id !== ownerId).slice(0, 30);
  if (!want.length) return [];
  const { data } = await db.from("friendships").select("user_low, user_high").or(`user_low.eq.${ownerId},user_high.eq.${ownerId}`).limit(5000);
  const friends = new Set(((data ?? []) as Row[]).map((f) => (f.user_low === ownerId ? (f.user_high as string) : (f.user_low as string))));
  return want.every((id) => friends.has(id)) ? want : null;
}

const PUBLIC_MEDIA = () => [process.env.R2_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL].filter((u): u is string => !!u).map((u) => new URL(u).host);

function cleanMedia(media: MemoryInput["media"]): { kind: string; post_id: string | null; url: string | null }[] | null {
  const out: { kind: string; post_id: string | null; url: string | null }[] = [];
  const hosts = PUBLIC_MEDIA();
  for (const m of (media ?? []).slice(0, 20)) {
    if (m.kind === "post") {
      if (!m.postId || !/^[0-9a-f-]{36}$/i.test(m.postId)) return null;
      out.push({ kind: "post", post_id: m.postId, url: null });
    } else if (m.kind === "link") {
      if (!m.url || !/^https:\/\/[^\s<>"]{3,590}$/.test(m.url)) return null;
      out.push({ kind: "link", post_id: null, url: m.url });
    } else {
      // photos and videos are references to OUR media hosts only (no hotlinking, no tracking pixels)
      try {
        const u = new URL(m.url ?? "");
        if (u.protocol !== "https:" || !hosts.includes(u.host)) return null;
      } catch {
        return null;
      }
      out.push({ kind: m.kind, post_id: null, url: m.url! });
    }
  }
  return out;
}

async function circleOwned(db: ReturnType<typeof createAdminClient>, ownerId: string, circleId: string | null | undefined): Promise<boolean> {
  if (!circleId) return true;
  const { data } = await db.from("social_circles").select("id").eq("id", circleId).eq("owner_id", ownerId).maybeSingle();
  return !!data;
}

export async function saveMemory(ownerId: string, input: MemoryInput & { id?: string; sourceKind?: SourceKind; sourceRef?: string | null }): Promise<Result<{ memory: Memory }>> {
  const v = validateMemory(input);
  if (!v.ok) return fail(v.error);
  const db = createAdminClient();
  const ppl = input.peopleIds ? await allowedPeople(db, ownerId, input.peopleIds) : undefined;
  if (ppl === null) return fail("You can add friends to a memory, no one else.", 403);
  const media = input.media ? cleanMedia(input.media) : undefined;
  if (media === null) return fail("A photo or video must be one already on Frenzsave; links must start with https://");
  if (!(await circleOwned(db, ownerId, input.visibility === "circle" ? input.circleId : null))) return fail("That circle isn't yours.", 403);
  const cols: Row = {
    title: input.title.trim(),
    note: input.note?.trim() || null,
    category: input.category ?? suggestCategory(`${input.title} ${input.note ?? ""}`)?.category ?? "friendship",
    occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
    place: input.place?.trim() || null,
    feeling: input.feeling || null,
    link_url: input.linkUrl || null,
    visibility: input.visibility ?? "private",
    circle_id: input.visibility === "circle" ? input.circleId : null,
    pinned: !!input.pinned,
  };
  let id = input.id;
  if (id) {
    const { data, error } = await db.from("memories").update(cols).eq("id", id).eq("owner_id", ownerId).is("deleted_at", null).select("id");
    if (error) return MISSING(error.message) ? fail("Memories arrive with the next update.", 503) : fail("Couldn't save that.", 500);
    if (!(data ?? []).length) return fail("Not found.", 404);
  } else {
    const { data, error } = await db.from("memories").insert({ ...cols, owner_id: ownerId, source_kind: input.sourceKind ?? "manual", source_ref: input.sourceRef ?? null }).select("id").single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return fail("You already kept this one.", 409);
      return MISSING(error.message) ? fail("Memories arrive with the next update.", 503) : fail("Couldn't save that.", 500);
    }
    id = (data as Row).id as string;
  }
  if (ppl !== undefined) {
    await db.from("memory_people").delete().eq("memory_id", id);
    if (ppl.length) await db.from("memory_people").insert(ppl.map((u) => ({ memory_id: id, user_id: u })));
  }
  if (media !== undefined) {
    await db.from("memory_media").delete().eq("memory_id", id);
    if (media.length) await db.from("memory_media").insert(media.map((m, idx) => ({ memory_id: id, idx, ...m })));
  }
  const memory = (await getMemory(ownerId, id))!;
  return { ok: true, memory };
}

/** Keep a suggestion: re-derived on the server from the real source, never from the browser's copy. */
export async function keepSuggestion(ownerId: string, sourceKind: SourceKind, sourceRef: string): Promise<Result<{ memory: Memory }>> {
  const s = (await memorySuggestions(ownerId, 200)).find((x) => x.sourceKind === sourceKind && x.sourceRef === sourceRef);
  if (!s) return fail("That suggestion isn't available any more.", 404);
  return saveMemory(ownerId, { title: s.title, category: s.category, occurredOn: s.occurredOn, sourceKind: s.sourceKind, sourceRef: s.sourceRef, peopleIds: s.personId ? [s.personId] : [], visibility: "private" });
}

export async function dismiss(ownerId: string, key: string): Promise<Result> {
  if (!/^(sugg|otd|dup|col):[\w:|.\-]{1,200}$/.test(key)) return fail("Invalid.");
  const { error } = await createAdminClient().from("memory_reminder_dismissals").upsert({ owner_id: ownerId, key }, { onConflict: "owner_id,key" });
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

export async function setState(ownerId: string, id: string, action: "archive" | "unarchive" | "delete" | "restore" | "purge" | "pin" | "unpin"): Promise<Result> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const q = db.from("memories");
  const { data, error } =
    action === "purge"
      ? await q.delete().eq("id", id).eq("owner_id", ownerId).not("deleted_at", "is", null).select("id")
      : await q
          .update(action === "archive" ? { archived_at: now } : action === "unarchive" ? { archived_at: null } : action === "delete" ? { deleted_at: now } : action === "restore" ? { deleted_at: null } : { pinned: action === "pin" })
          .eq("id", id)
          .eq("owner_id", ownerId)
          .select("id");
  if (error) return fail("Couldn't save that.", 500);
  return (data ?? []).length ? { ok: true } : fail("Not found.", 404);
}

export async function memoryVersions(ownerId: string, id: string): Promise<{ version: number; snapshot: Row; at: string }[]> {
  const db = createAdminClient();
  const { data: own } = await db.from("memories").select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (!own) return [];
  const { data } = await db.from("memory_versions").select("version, snapshot, created_at").eq("memory_id", id).order("version", { ascending: false }).limit(50);
  return ((data ?? []) as Row[]).map((v) => ({ version: Number(v.version), snapshot: v.snapshot as Row, at: v.created_at as string }));
}

/** Put an earlier version back. The version being replaced is itself kept (the trigger), so nothing is ever lost. */
export async function restoreVersion(ownerId: string, id: string, version: number): Promise<Result<{ memory: Memory }>> {
  const v = (await memoryVersions(ownerId, id)).find((x) => x.version === version);
  if (!v) return fail("That version isn't available.", 404);
  const s = v.snapshot;
  const { error } = await createAdminClient()
    .from("memories")
    .update({ title: s.title, note: s.note, category: s.category, occurred_on: s.occurred_on, place: s.place, feeling: s.feeling, link_url: s.link_url, visibility: s.visibility === "circle" && !s.circle_id ? "private" : s.visibility, circle_id: s.circle_id, pinned: s.pinned })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) return fail("Couldn't restore it.", 500);
  return { ok: true, memory: (await getMemory(ownerId, id))! };
}

// ─── Reads for one memory, and shared with me ───────────────────────────────

async function viewerFacts(db: ReturnType<typeof createAdminClient>, ownerId: string, viewerId: string): Promise<{ isFriend: boolean; circleIds: Set<string>; blocked: boolean }> {
  const [lo, hi] = ownerId < viewerId ? [ownerId, viewerId] : [viewerId, ownerId];
  const [f, c, b] = await Promise.all([
    db.from("friendships").select("user_low").eq("user_low", lo).eq("user_high", hi).maybeSingle(),
    db.from("circle_members").select("circle_id").eq("owner_id", ownerId).eq("member_id", viewerId).limit(200),
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${ownerId},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${ownerId})`).limit(1),
  ]);
  return { isFriend: !!f.data, circleIds: new Set(((c.data ?? []) as Row[]).map((x) => x.circle_id as string)), blocked: (b.data ?? []).length > 0 };
}

export async function getMemory(viewerId: string, id: string): Promise<Memory | null> {
  const db = createAdminClient();
  const { data } = await db.from("memories").select(COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  const [m] = await hydrate(db, [data as Row]);
  if (!m) return null;
  if (m.ownerId === viewerId) return m;
  const facts = await viewerFacts(db, m.ownerId, viewerId);
  return canViewMemory({ ownerId: m.ownerId, visibility: m.visibility, circleId: m.circleId, deleted: !!m.deletedAt || !!m.archivedAt }, { id: viewerId, inPeople: m.people.some((p) => p.id === viewerId), ...facts }) ? m : null;
}

/** Memories friends put me on that I'm allowed to see. */
export async function sharedWithMe(viewerId: string): Promise<(Memory & { owner: PersonLite | null })[]> {
  const db = createAdminClient();
  const { data: tags } = await db.from("memory_people").select("memory_id").eq("user_id", viewerId).limit(500);
  const ids = ((tags ?? []) as Row[]).map((t) => t.memory_id as string);
  if (!ids.length) return [];
  const { data } = await db.from("memories").select(COLS).in("id", ids).is("deleted_at", null).is("archived_at", null).neq("visibility", "private").order("occurred_on", { ascending: false }).limit(200);
  const ms = await hydrate(db, (data ?? []) as Row[]);
  const owners = await people(db, ms.map((m) => m.ownerId));
  const out: (Memory & { owner: PersonLite | null })[] = [];
  for (const m of ms) {
    const facts = await viewerFacts(db, m.ownerId, viewerId);
    if (canViewMemory({ ownerId: m.ownerId, visibility: m.visibility, circleId: m.circleId, deleted: false }, { id: viewerId, inPeople: true, ...facts })) out.push({ ...m, owner: owners.get(m.ownerId) ?? null });
  }
  return out;
}

// ─── Collections ────────────────────────────────────────────────────────────

export async function saveCollection(ownerId: string, input: { id?: string; title: string; description?: string | null; visibility?: "private" | "people" | "friends"; memoryIds?: string[]; suggestionKey?: string | null }): Promise<Result<{ id: string }>> {
  const title = input.title.trim();
  if (!title || title.length > 80 || /[<>]/.test(title)) return fail("Give the collection a title of up to 80 characters.");
  if (input.description && (input.description.length > 400 || /[<>]/.test(input.description))) return fail("Keep the description short and plain.");
  const db = createAdminClient();
  const cols = { title, description: input.description?.trim() || null, visibility: input.visibility ?? "private", suggestion_key: input.suggestionKey ?? null, updated_at: new Date().toISOString() };
  let id = input.id;
  if (id) {
    const { data } = await db.from("memory_collections").update(cols).eq("id", id).eq("owner_id", ownerId).select("id");
    if (!(data ?? []).length) return fail("Not found.", 404);
  } else {
    const { data, error } = await db.from("memory_collections").insert({ ...cols, owner_id: ownerId }).select("id").single();
    if (error) return MISSING(error.message) ? fail("Memories arrive with the next update.", 503) : fail("Couldn't save that.", 500);
    id = (data as Row).id as string;
  }
  if (input.memoryIds) {
    // only the owner's own memories go in
    const { data: mine } = await db.from("memories").select("id").eq("owner_id", ownerId).in("id", input.memoryIds.slice(0, 500));
    const ok = ((mine ?? []) as Row[]).map((m) => m.id as string);
    await db.from("memory_collection_items").delete().eq("collection_id", id);
    if (ok.length) await db.from("memory_collection_items").insert(ok.map((memory_id) => ({ collection_id: id, memory_id })));
  }
  return { ok: true, id: id! };
}

export async function deleteCollection(ownerId: string, id: string): Promise<Result> {
  const { error } = await createAdminClient().from("memory_collections").delete().eq("id", id).eq("owner_id", ownerId);
  return error ? fail("Couldn't delete it.", 500) : { ok: true };
}

// ─── Map and export ─────────────────────────────────────────────────────────

/** Social History Map™: the people your memories are with, and the categories you share with each. */
export function historyMap(memories: readonly Memory[]): { person: PersonLite; count: number; categories: MemoryCategory[]; first: string; last: string }[] {
  const by = new Map<string, { person: PersonLite; count: number; categories: Set<MemoryCategory>; first: string; last: string }>();
  for (const m of memories)
    for (const p of m.people) {
      const e = by.get(p.id) ?? { person: p, count: 0, categories: new Set<MemoryCategory>(), first: m.occurredOn, last: m.occurredOn };
      e.count++;
      e.categories.add(m.category);
      if (m.occurredOn < e.first) e.first = m.occurredOn;
      if (m.occurredOn > e.last) e.last = m.occurredOn;
      by.set(p.id, e);
    }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 24).map((e) => ({ ...e, categories: [...e.categories] }));
}

export async function exportMemories(ownerId: string): Promise<Row> {
  const [lib, other] = await Promise.all([memoryLibrary(ownerId), archivedAndTrash(ownerId)]);
  const strip = (m: Memory) => ({ title: m.title, note: m.note, category: m.category, date: m.occurredOn, place: m.place, feeling: m.feeling, link: m.linkUrl, visibility: m.visibility, pinned: m.pinned, people: m.people.map((p) => `@${p.handle}`), media: m.media, source: m.sourceKind, version: m.version });
  return { exportedAt: new Date().toISOString(), memories: lib.memories.map(strip), archived: other.archived.map(strip), collections: lib.collections.map((c) => ({ title: c.title, description: c.description, visibility: c.visibility, memories: c.memoryIds.length })) };
}

// ─── For the composer ────────────────────────────────────────────────────────

/** The member's friends (who may be put on a memory) and their own circles (an audience). */
export async function composerOptions(ownerId: string): Promise<{ friends: PersonLite[]; circles: { id: string; name: string }[]; joinedAt: string | null }> {
  const db = createAdminClient();
  const [fr, circ, prof] = await Promise.all([
    db.from("friendships").select("user_low, user_high").or(`user_low.eq.${ownerId},user_high.eq.${ownerId}`).limit(1000),
    db.from("social_circles").select("id, name").eq("owner_id", ownerId).order("created_at").limit(100),
    db.from("profiles").select("created_at").eq("id", ownerId).maybeSingle(),
  ]);
  const ids = ((fr.data ?? []) as Row[]).map((f) => (f.user_low === ownerId ? (f.user_high as string) : (f.user_low as string)));
  const who = await people(db, ids);
  return {
    friends: [...who.values()].sort((a, b) => a.name.localeCompare(b.name)),
    circles: ((circ.data ?? []) as Row[]).map((c) => ({ id: c.id as string, name: c.name as string })),
    joinedAt: ((prof.data as Row | null)?.created_at as string | undefined) ?? null,
  };
}
