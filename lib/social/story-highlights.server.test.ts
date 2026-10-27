import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Story highlights (Stories Part 5, 2026-10-27; 0289). Owner: "build everything so nothing is fake or coming soon in
 * the story features". Pinned here, against an in-memory stand-in for the two tables and `stories`:
 *   · who sees: the stories rule (canSeeStoriesOf) — refused means an empty list / not found, never the rows;
 *   · who writes: the owner, and only with their OWN stories (a stranger's story id is refused before any write);
 *   · the copy: an item keeps the story's media reference, so it outlives the story row;
 *   · removal: the last story out deletes the highlight; files are offered to release-unreferenced afterwards;
 *   · the pure rules: title cleaning, cover choice, order and counts.
 */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { stories: [], story_highlights: [], story_highlight_items: [] };
let visible = true;
const released: unknown[][] = [];
let nextId = 1;
const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

function query(table: string) {
  const rows = () => tables[table]!;
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let head = false;
  let order: { col: string; asc: boolean } | null = null;
  const matched = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op === "update") {
      for (const r of matched()) Object.assign(r, patch);
      return { data: null, error: null };
    }
    if (op === "delete") {
      const gone = new Set(matched());
      tables[table] = rows().filter((r) => !gone.has(r));
      if (table === "story_highlights") tables.story_highlight_items = tables.story_highlight_items!.filter((i) => !(tables.story_highlights ?? []).every((h) => h.id !== i.highlight_id) || false);
      return { data: null, error: null };
    }
    let out = matched();
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
    }
    return head ? { data: null, error: null, count: out.length } : { data: out.map((r) => ({ ...r })), error: null, count: out.length };
  };
  const q = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      head = !!opts?.head;
      return q;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return q;
    },
    in(col: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[col]));
      return q;
    },
    order(col: string, o?: { ascending?: boolean }) {
      order = { col, asc: o?.ascending !== false };
      return q;
    },
    limit() {
      return q;
    },
    update(p: Row) {
      op = "update";
      patch = p;
      return q;
    },
    delete() {
      op = "delete";
      return q;
    },
    maybeSingle: async () => {
      const r = run();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: null };
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
    insert(row: Row) {
      const r = { id: id(), position: 0, created_at: new Date().toISOString(), cover_url: null, ...row };
      rows().push(r);
      return { select: () => ({ single: async () => ({ data: r, error: null }) }) };
    },
    upsert: async (row: Row) => {
      const dup = rows().some((r) => r.highlight_id === row.highlight_id && r.source_story_id === row.source_story_id);
      if (!dup) rows().push({ id: id(), added_at: new Date().toISOString(), ...row });
      return { error: null };
    },
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => query(t) }) }));
vi.mock("@/lib/social/stories", () => ({ canSeeStoriesOf: vi.fn(async () => visible) }));
vi.mock("@/lib/storage/release-unreferenced", () => ({ releaseUnreferencedUploads: vi.fn(async (urls: unknown[]) => void released.push(urls)) }));

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test";

const hl = await import("./story-highlights");
const { assembleHighlights, coverOf, normalizeHighlightTitle } = hl;

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const story = (user: string, kind: "image" | "video" = "image") => {
  const r = { id: id(), user_id: user, media_url: `https://media.frenzsave.com/story-media/${user}/s-${nextId}.${kind === "video" ? "mp4" : "jpg"}`, media_kind: kind, thumbnail_url: kind === "video" ? `https://media.frenzsave.com/story-media/${user}/s-${nextId}-poster.jpg` : null, caption: "a day", created_at: new Date(Date.now() - nextId * 1000).toISOString() };
  tables.stories!.push(r);
  return r;
};

beforeEach(() => {
  tables.stories = [];
  tables.story_highlights = [];
  tables.story_highlight_items = [];
  visible = true;
  released.length = 0;
});

describe("the pure rules", () => {
  it("titles: trimmed and collapsed, 1–30 characters, anything else refused", () => {
    expect(normalizeHighlightTitle("  Summer   trip ")).toBe("Summer trip");
    expect(normalizeHighlightTitle("")).toBeNull();
    expect(normalizeHighlightTitle("   ")).toBeNull();
    expect(normalizeHighlightTitle("x".repeat(30))).toBe("x".repeat(30));
    expect(normalizeHighlightTitle("x".repeat(31))).toBeNull();
    expect(normalizeHighlightTitle(42)).toBeNull();
  });
  it("cover: a video's poster, an image itself", () => {
    expect(coverOf({ mediaKind: "video", mediaUrl: "v.mp4", thumbnailUrl: "p.jpg" })).toBe("p.jpg");
    expect(coverOf({ mediaKind: "image", mediaUrl: "i.jpg", thumbnailUrl: null })).toBe("i.jpg");
  });
  it("assembly: counts, the newest story as the default cover, a chosen cover wins, empty highlights left out", () => {
    const rows = [
      { id: "a", user_id: ME, title: "A", cover_url: null, position: 0, created_at: "2026-10-01T00:00:00Z" },
      { id: "b", user_id: ME, title: "B", cover_url: "chosen.jpg", position: 0, created_at: "2026-10-02T00:00:00Z" },
      { id: "c", user_id: ME, title: "Empty", cover_url: null, position: 0, created_at: "2026-10-03T00:00:00Z" },
    ];
    const item = (h: string, url: string, at: string, sid: string) => ({ id: url, highlight_id: h, source_story_id: sid, media_url: url, media_kind: "image" as const, thumbnail_url: null, caption: null, story_created_at: at });
    const out = assembleHighlights(rows, [item("a", "old.jpg", "2026-09-01T00:00:00Z", "s1"), item("a", "new.jpg", "2026-09-05T00:00:00Z", "s2"), item("b", "b.jpg", "2026-09-02T00:00:00Z", "s3")], "s2");
    expect(out.map((h) => h.id)).toEqual(["b", "a"]); // newest highlight first; "c" has nothing to show
    expect(out.find((h) => h.id === "a")).toMatchObject({ itemCount: 2, coverUrl: "new.jpg", containsStory: true });
    expect(out.find((h) => h.id === "b")).toMatchObject({ coverUrl: "chosen.jpg", containsStory: false });
    // without `containing`, the flag is not there at all (a visitor's list)
    expect(assembleHighlights(rows, [item("a", "x.jpg", "2026-09-01T00:00:00Z", "s1")])[0]).not.toHaveProperty("containsStory");
  });
});

describe("who writes: the owner, with their own stories", () => {
  it("creates a highlight from your own story, copying its media reference", async () => {
    const s = story(ME, "video");
    const res = await hl.createHighlight(ME, " Trips ", [s.id]);
    expect(res.ok).toBe(true);
    expect(tables.story_highlights).toHaveLength(1);
    expect(tables.story_highlights![0]).toMatchObject({ user_id: ME, title: "Trips" });
    expect(tables.story_highlight_items![0]).toMatchObject({ source_story_id: s.id, media_url: s.media_url, thumbnail_url: s.thumbnail_url, media_kind: "video" });
  });

  it("🔴 a stranger's story is refused before anything is written", async () => {
    const theirs = story(OTHER);
    expect(await hl.createHighlight(ME, "Theirs", [theirs.id])).toEqual({ ok: false, reason: "story_not_found" });
    expect(tables.story_highlights).toHaveLength(0);
  });

  it("🔴 someone else's highlight cannot be added to, renamed or deleted", async () => {
    const s = story(OTHER);
    await hl.createHighlight(OTHER, "Mine", [s.id]);
    const hid = tables.story_highlights![0]!.id as string;
    const mine = story(ME);
    expect(await hl.addStoryToHighlight(ME, hid, mine.id)).toEqual({ ok: false, reason: "not_yours" });
    expect(await hl.updateHighlight(ME, hid, { title: "Hijack" })).toEqual({ ok: false, reason: "not_yours" });
    expect(await hl.deleteHighlight(ME, hid)).toEqual({ ok: false, reason: "not_yours" });
    expect(tables.story_highlights![0]).toMatchObject({ title: "Mine" });
  });

  it("adding the same story twice is a success that changes nothing", async () => {
    const s = story(ME);
    await hl.createHighlight(ME, "Once", [s.id]);
    const hid = tables.story_highlights![0]!.id as string;
    expect(await hl.addStoryToHighlight(ME, hid, s.id)).toEqual({ ok: true, value: { added: false } });
    expect(tables.story_highlight_items).toHaveLength(1);
  });

  it("a bad title is refused", async () => {
    const s = story(ME);
    expect(await hl.createHighlight(ME, "   ", [s.id])).toEqual({ ok: false, reason: "bad_title" });
    expect(await hl.createHighlight(ME, "x".repeat(31), [s.id])).toEqual({ ok: false, reason: "bad_title" });
  });
});

describe("who sees: the stories rule", () => {
  it("a viewer who may see the member's stories gets the highlights", async () => {
    const s = story(ME);
    await hl.createHighlight(ME, "Seen", [s.id]);
    expect(await hl.listHighlights(ME, OTHER)).toHaveLength(1);
  });
  it("🔴 a viewer who may NOT (a block, a private profile…) gets nothing — no rows, no media", async () => {
    const s = story(ME);
    await hl.createHighlight(ME, "Hidden", [s.id]);
    visible = false;
    expect(await hl.listHighlights(ME, OTHER)).toEqual([]);
    expect(await hl.getHighlight(tables.story_highlights![0]!.id as string, OTHER)).toBeNull();
  });
});

describe("removing", () => {
  it("the last story out deletes the highlight, and its files are offered for release", async () => {
    const s = story(ME);
    await hl.createHighlight(ME, "Short", [s.id]);
    const hid = tables.story_highlights![0]!.id as string;
    expect(await hl.removeFromHighlight(ME, hid, { storyId: s.id })).toEqual({ ok: true, value: { highlightDeleted: true } });
    expect(tables.story_highlights).toHaveLength(0);
    expect(released.flat()).toContain(s.media_url);
  });
  it("with stories left, the highlight stays", async () => {
    const a = story(ME);
    const b = story(ME);
    await hl.createHighlight(ME, "Two", [a.id, b.id]);
    const hid = tables.story_highlights![0]!.id as string;
    expect(await hl.removeFromHighlight(ME, hid, { storyId: a.id })).toEqual({ ok: true, value: { highlightDeleted: false } });
    expect(tables.story_highlight_items).toHaveLength(1);
  });
});
