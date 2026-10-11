/**
 * Shared Memories™ — the pure rules (Feature 19 · Part 14).
 *
 * ── What "AI organization" means here, honestly ───────────────────────────
 * The brief asks for AI that groups memories, suggests albums, finds duplicates,
 * spots important moments and answers natural-language search. All of that is
 * done below with explainable rules over the member's OWN memories — no model,
 * no third party, no image analysis — so every suggestion can say why it was
 * made and nothing private leaves the server. Every suggestion is optional and
 * editable; nothing is filed without the member's tap.
 *
 * Pure: no React, no Supabase, no I/O. Tested in engine.test.ts.
 */

export const MEMORY_CATEGORIES = {
  friendship: "Friendship",
  travel: "Travel",
  education: "Education",
  business: "Business",
  photography: "Photography",
  programming: "Programming",
  fitness: "Fitness",
  music: "Music",
  gaming: "Gaming",
  nature: "Nature",
  communities: "Communities",
  events: "Events",
  family: "Family",
  projects: "Projects",
  marketplace: "Marketplace",
  creator: "Creator collaborations",
} as const;
export type MemoryCategory = keyof typeof MEMORY_CATEGORIES;
export const isMemoryCategory = (v: unknown): v is MemoryCategory => typeof v === "string" && v in MEMORY_CATEGORIES;

export const FEELINGS = { joyful: "Joyful", grateful: "Grateful", proud: "Proud", calm: "Calm", excited: "Excited", nostalgic: "Nostalgic", loved: "Loved", inspired: "Inspired" } as const;
export type Feeling = keyof typeof FEELINGS;
export const isFeeling = (v: unknown): v is Feeling => typeof v === "string" && v in FEELINGS;

export const VISIBILITY = { private: "Only me", people: "People in it", friends: "Friends", circle: "A circle" } as const;
export type MemoryVisibility = keyof typeof VISIBILITY;
export const isVisibility = (v: unknown): v is MemoryVisibility => typeof v === "string" && v in VISIBILITY;

export const SOURCE_KINDS = ["manual", "friendship", "first_message", "collaboration", "pro_connection", "recommendation", "membership", "capsule", "first_post", "post"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface MemoryLite {
  id: string;
  title: string;
  note: string | null;
  category: MemoryCategory;
  occurredOn: string; // YYYY-MM-DD
  place: string | null;
  sourceKind: SourceKind;
  sourceRef: string | null;
  pinned: boolean;
  people: { id: string; name: string; handle: string }[];
  mediaUrls: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function validateMemory(input: { title?: unknown; note?: unknown; category?: unknown; occurredOn?: unknown; place?: unknown; feeling?: unknown; linkUrl?: unknown; visibility?: unknown; circleId?: unknown }): { ok: true } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 1 || title.length > 120) return { ok: false, error: "Give it a title of up to 120 characters." };
  if (/[<>]/.test(title)) return { ok: false, error: "Keep the title to plain text." };
  if (input.note != null && (typeof input.note !== "string" || input.note.length > 4000 || /[<>]/.test(input.note))) return { ok: false, error: "Keep the note to 4,000 characters of plain text." };
  if (input.category != null && !isMemoryCategory(input.category)) return { ok: false, error: "Pick a category." };
  if (input.occurredOn != null && (typeof input.occurredOn !== "string" || !ISO_DAY.test(input.occurredOn) || Number.isNaN(Date.parse(input.occurredOn)))) return { ok: false, error: "Pick a date." };
  if (input.place != null && (typeof input.place !== "string" || input.place.length > 120 || /[<>]/.test(input.place))) return { ok: false, error: "Keep the place to 120 characters." };
  if (input.feeling != null && !isFeeling(input.feeling)) return { ok: false, error: "Pick a feeling, or none." };
  if (input.linkUrl != null && (typeof input.linkUrl !== "string" || !/^https:\/\/[^\s<>"]{3,590}$/.test(input.linkUrl))) return { ok: false, error: "Links must start with https://" };
  if (input.visibility != null && !isVisibility(input.visibility)) return { ok: false, error: "Pick who can see it." };
  if (input.visibility === "circle" && (typeof input.circleId !== "string" || !input.circleId)) return { ok: false, error: "Pick a circle." };
  return { ok: true };
}

// ─── Category suggestion (explainable keywords) ─────────────────────────────

const KEYWORDS: [MemoryCategory, RegExp][] = [
  ["travel", /\b(trip|travel|beach|flight|holiday|vacation|visit(ed)?|abroad|hotel|road ?trip|tour)\b/i],
  ["education", /\b(school|class|course|lecture|exam|university|college|campus|study|graduat\w*|semester)\b/i],
  ["business", /\b(business|startup|client|deal|launch(ed)?|company|contract|revenue|meeting|partner(ship)?)\b/i],
  ["photography", /\b(photo(s|graphy)?|camera|shoot|portrait|lens|picture)\b/i],
  ["programming", /\b(code|coding|program(ming)?|app|bug|deploy|hackathon|developer|github|website)\b/i],
  ["fitness", /\b(gym|run(ning)?|workout|marathon|football|yoga|training|match|fitness)\b/i],
  ["music", /\b(song|music|concert|album|band|sing(ing)?|studio|beat|playlist)\b/i],
  ["gaming", /\b(game|gaming|play(ed)? (fifa|cod|pubg)|console|tournament|esports)\b/i],
  ["nature", /\b(nature|hike|hiking|mountain|forest|waterfall|park|camping|sunset)\b/i],
  ["family", /\b(family|mum|mom|dad|sister|brother|cousin|wedding|birthday|baby|grand(ma|pa))\b/i],
  ["events", /\b(event|party|festival|meetup|conference|show|celebration|ceremony)\b/i],
  ["projects", /\b(project|built|build|design(ed)?|research|paper|prototype)\b/i],
  ["marketplace", /\b(sold|bought|order|shop|market(place)?|customer)\b/i],
  ["communities", /\b(community|group|club|members?|volunteer\w*)\b/i],
  ["creator", /\b(collab(oration)?|creator|video|reel|channel|content|subscribers?)\b/i],
];

/** A category for this text, with the word that suggested it — or null. */
export function suggestCategory(text: string): { category: MemoryCategory; because: string } | null {
  for (const [category, re] of KEYWORDS) {
    const m = re.exec(text);
    if (m) return { category, because: m[0] };
  }
  return null;
}

// ─── Collections the engine suggests ────────────────────────────────────────

export interface CollectionSuggestion {
  key: string;
  title: string;
  why: string;
  memoryIds: string[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MIN_GROUP = 3;

/** Albums worth making: by year, by month, by category and by person — only groups of 3+, biggest first. */
export function suggestCollections(memories: readonly MemoryLite[], existingKeys: ReadonlySet<string> = new Set()): CollectionSuggestion[] {
  const groups = new Map<string, CollectionSuggestion>();
  const add = (key: string, title: string, why: string, id: string) => {
    const g = groups.get(key) ?? { key, title, why, memoryIds: [] };
    if (!g.memoryIds.includes(id)) g.memoryIds.push(id);
    groups.set(key, g);
  };
  for (const m of memories) {
    const [y, mo] = m.occurredOn.split("-");
    add(`month:${y}-${mo}`, `${MONTHS[Number(mo) - 1]} ${y}`, "Memories from the same month", m.id);
    add(`year:${y}`, `${y} in memories`, "Everything from one year", m.id);
    add(`cat:${m.category}`, `${MEMORY_CATEGORIES[m.category]} journey`, `Your ${MEMORY_CATEGORIES[m.category].toLowerCase()} memories`, m.id);
    for (const p of m.people) add(`person:${p.id}`, `With ${p.name}`, `Memories you share with ${p.name}`, m.id);
  }
  const all = [...groups.values()].filter((g) => g.memoryIds.length >= MIN_GROUP && !existingKeys.has(g.key));
  // a year that is identical to one of its months says nothing new
  const sets = new Map(all.map((g) => [g.key, [...g.memoryIds].sort().join(",")]));
  return all
    .filter((g) => !(g.key.startsWith("year:") && all.some((o) => o.key.startsWith("month:") && sets.get(o.key) === sets.get(g.key))))
    .sort((a, b) => b.memoryIds.length - a.memoryIds.length || a.title.localeCompare(b.title))
    .slice(0, 8);
}

// ─── Duplicates ─────────────────────────────────────────────────────────────

/** Pairs that look like the same memory: the same media, or the same title on the same day. */
export function findDuplicates(memories: readonly MemoryLite[]): { a: string; b: string; why: string }[] {
  const out: { a: string; b: string; why: string }[] = [];
  const byMedia = new Map<string, string>();
  const byTitleDay = new Map<string, string>();
  for (const m of memories) {
    for (const u of m.mediaUrls) {
      const prev = byMedia.get(u);
      if (prev && prev !== m.id) out.push({ a: prev, b: m.id, why: "Same photo or video" });
      else byMedia.set(u, m.id);
    }
    const k = `${m.title.trim().toLowerCase()}|${m.occurredOn}`;
    const prev = byTitleDay.get(k);
    if (prev && prev !== m.id) out.push({ a: prev, b: m.id, why: "Same title on the same day" });
    else byTitleDay.set(k, m.id);
  }
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = [d.a, d.b].sort().join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Important moments ──────────────────────────────────────────────────────

/** Why a memory stands out, in words. Never a score shown to anyone. */
export function importance(m: MemoryLite): { weight: number; reasons: string[] } {
  const reasons: string[] = [];
  let weight = 0;
  if (m.pinned) { weight += 5; reasons.push("You pinned it"); }
  if (m.people.length >= 3) { weight += 3; reasons.push(`Shared with ${m.people.length} people`); }
  else if (m.people.length) { weight += 1; reasons.push("Shared with someone"); }
  if (m.mediaUrls.length) { weight += 2; reasons.push("Has photos or videos"); }
  if ((m.note ?? "").length > 200) { weight += 1; reasons.push("You wrote about it"); }
  if (["first_message", "friendship", "first_post"].includes(m.sourceKind)) { weight += 2; reasons.push("A first"); }
  return { weight, reasons };
}

export function importantMoments(memories: readonly MemoryLite[], limit = 5): { id: string; reasons: string[] }[] {
  return memories
    .map((m) => ({ m, s: importance(m) }))
    .filter((x) => x.s.weight >= 3)
    .sort((a, b) => b.s.weight - a.s.weight || b.m.occurredOn.localeCompare(a.m.occurredOn))
    .slice(0, limit)
    .map((x) => ({ id: x.m.id, reasons: x.s.reasons }));
}

// ─── On this day ────────────────────────────────────────────────────────────

/** Memories from today's date in earlier years, newest first, with how long ago. */
export function onThisDay(memories: readonly MemoryLite[], today: Date): { id: string; yearsAgo: number }[] {
  const md = today.toISOString().slice(5, 10);
  const year = today.getUTCFullYear();
  return memories
    .filter((m) => m.occurredOn.slice(5, 10) === md && Number(m.occurredOn.slice(0, 4)) < year)
    .map((m) => ({ id: m.id, yearsAgo: year - Number(m.occurredOn.slice(0, 4)) }))
    .sort((a, b) => a.yearsAgo - b.yearsAgo);
}

// ─── Natural-language search ────────────────────────────────────────────────

export interface ParsedQuery {
  terms: string[];
  personIds: string[];
  categories: MemoryCategory[];
  /** the word that implied the category ("trip" → travel): a memory with that word matches too */
  categoryWords: string[];
  sourceKinds: SourceKind[];
  year: number | null;
}

const STOP = new Set(["the", "a", "an", "our", "my", "with", "and", "of", "at", "in", "on", "to", "from", "we", "us", "that", "this", "when", "memory", "memories", "time"]);

/**
 * "the project with Sarah" → people: Sarah, category: projects.
 * "our first conversation" → kind: first message. "the beach trip 2025" → travel, 2025, "beach".
 * Every part it understood is shown back to the member, so a search is never a black box.
 */
export function parseMemoryQuery(q: string, people: readonly { id: string; name: string; handle: string }[]): ParsedQuery {
  let text = ` ${q.toLowerCase().replace(/[^\p{L}\p{N}@_\s'-]/gu, " ")} `;
  const personIds: string[] = [];
  for (const p of people) {
    const names = [p.handle.toLowerCase(), `@${p.handle.toLowerCase()}`, ...p.name.toLowerCase().split(/\s+/).filter((n) => n.length >= 3)];
    for (const n of names) {
      const re = new RegExp(`\\s${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}('s)?\\s`, "i");
      if (re.test(text)) {
        if (!personIds.includes(p.id)) personIds.push(p.id);
        text = text.replace(re, " ");
      }
    }
  }
  const sourceKinds: SourceKind[] = [];
  if (/\bfirst (conversation|message|chat)\b/.test(text)) { sourceKinds.push("first_message"); text = text.replace(/\bfirst (conversation|message|chat)\b/, " "); }
  if (/\bfirst post\b/.test(text)) { sourceKinds.push("first_post"); text = text.replace(/\bfirst post\b/, " "); }
  if (/\b(became friends|friendship started|friends since)\b/.test(text)) sourceKinds.push("friendship");
  if (/\bcollab(oration)?s?\b/.test(text)) sourceKinds.push("collaboration");
  if (/\bcapsules?\b/.test(text)) sourceKinds.push("capsule");
  const yearM = /\b(19|20)\d{2}\b/.exec(text);
  const year = yearM ? Number(yearM[0]) : null;
  if (yearM) text = text.replace(yearM[0], " ");
  const categories: MemoryCategory[] = [];
  const categoryWords: string[] = [];
  const cat = suggestCategory(text);
  if (cat) { categories.push(cat.category); categoryWords.push(cat.because.toLowerCase()); }
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t) && !(cat && t === cat.because.toLowerCase()));
  return { terms, personIds, categories, categoryWords, sourceKinds, year };
}

/** Does a memory match a parsed query? Every filter that was understood must hold; terms match title, note, place or category. */
export function matchesQuery(m: MemoryLite, q: ParsedQuery): boolean {
  if (q.personIds.length && !q.personIds.every((id) => m.people.some((p) => p.id === id))) return false;
  if (q.sourceKinds.length && !q.sourceKinds.includes(m.sourceKind)) return false;
  if (q.year && Number(m.occurredOn.slice(0, 4)) !== q.year) return false;
  const hay = `${m.title} ${m.note ?? ""} ${m.place ?? ""} ${MEMORY_CATEGORIES[m.category]}`.toLowerCase();
  if (q.categories.length && !q.categories.includes(m.category) && !q.categoryWords.some((w) => hay.includes(w))) return false;
  return q.terms.every((t) => hay.includes(t));
}

// ─── Insights (private to the owner) ────────────────────────────────────────

export interface MemoryInsights {
  total: number;
  topPerson: { id: string; name: string; count: number } | null;
  busiestMonth: { label: string; count: number } | null;
  categories: { category: MemoryCategory; label: string; count: number }[];
  firstMemory: string | null;
  span: { days: number } | null;
}

export function memoryInsights(memories: readonly MemoryLite[]): MemoryInsights {
  const people = new Map<string, { name: string; count: number }>();
  const months = new Map<string, number>();
  const cats = new Map<MemoryCategory, number>();
  for (const m of memories) {
    for (const p of m.people) people.set(p.id, { name: p.name, count: (people.get(p.id)?.count ?? 0) + 1 });
    const k = m.occurredOn.slice(0, 7);
    months.set(k, (months.get(k) ?? 0) + 1);
    cats.set(m.category, (cats.get(m.category) ?? 0) + 1);
  }
  const top = [...people.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const busy = [...months.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  const dates = memories.map((m) => m.occurredOn).sort();
  return {
    total: memories.length,
    topPerson: top && top[1].count >= 2 ? { id: top[0], name: top[1].name, count: top[1].count } : null,
    busiestMonth: busy && busy[1] >= 2 ? { label: `${MONTHS[Number(busy[0].slice(5, 7)) - 1]} ${busy[0].slice(0, 4)}`, count: busy[1] } : null,
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, label: MEMORY_CATEGORIES[category], count })),
    firstMemory: dates[0] ?? null,
    span: dates.length >= 2 ? { days: Math.round((Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / 86_400_000) } : null,
  };
}

// ─── Who may see a memory ───────────────────────────────────────────────────

/**
 * The visibility decision, pure. `viewer` facts are computed by the server from the
 * graph (friends, circle membership); this function never trusts a client claim.
 */
export function canViewMemory(m: { ownerId: string; visibility: MemoryVisibility; circleId: string | null; deleted: boolean }, viewer: { id: string | null; isFriend: boolean; inPeople: boolean; circleIds: ReadonlySet<string>; blocked: boolean }): boolean {
  if (m.deleted || !viewer.id) return false;
  if (viewer.id === m.ownerId) return true;
  if (viewer.blocked) return false;
  switch (m.visibility) {
    case "private":
      return false;
    case "people":
      return viewer.inPeople;
    case "friends":
      return viewer.isFriend || viewer.inPeople;
    case "circle":
      return !!m.circleId && viewer.circleIds.has(m.circleId);
  }
}
