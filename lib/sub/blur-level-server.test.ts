import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0307 — the creator changes how blurry a locked post looks (owner, 2026-10-30). Driven against the real
 * setSubPostBlurLevel with a recording stand-in for the database: a change that needs a different stored size clears the
 * blurred stills and clips and deletes the old clip files, so no preview of the old size outlives the choice; a change
 * within the same size touches only the level. Before 0307 the change answers "arrives with the next update".
 */
const POST = "11111111-2222-4333-8444-555555555555";
const ME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://media.frenzsave.com/";

type Op = { table: string; op: "select" | "update"; values?: Record<string, unknown>; filters: [string, unknown][] };
let ops: Op[];
let current: { blur_level: string | null; blur_video_url: string | null } | null;
let items: { blur_video_url: string | null }[];
let missingColumn: boolean;

function from(table: string) {
  const op: Op = { table, op: "select", filters: [] };
  const result = () => {
    ops.push({ ...op, filters: [...op.filters] });
    if (missingColumn && table === "sub_posts") return { data: null, error: { message: 'column sub_posts.blur_level does not exist' } };
    if (op.op === "update") return { data: null, error: null };
    if (table === "sub_posts") return { data: current, error: null };
    return { data: items, error: null };
  };
  const api = {
    select: () => api,
    update: (values: Record<string, unknown>) => ((op.op = "update"), (op.values = values), api),
    eq: (c: string, v: unknown) => (op.filters.push([c, v]), api),
    maybeSingle: () => Promise.resolve(result()),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}

const deleted: string[] = [];
const afterTasks: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(fn) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/storage/r2", () => ({
  r2PublicUrl: (key: string) => `${BASE}${key}`,
  deleteR2: async (key: string) => (deleted.push(key), true),
  deletePrivate: async () => {},
  hasPrivateR2: true,
  presignPrivateGet: async () => "",
  presignPrivatePut: async () => "",
  readPrivatePrefix: async () => null,
}));
const kicks = vi.fn();
vi.mock("@/lib/sub/blur-clip-kick", () => ({ kickBlurClips: () => kicks() }));
const ensured: string[] = [];
vi.mock("@/lib/sub/blur-preview", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/sub/blur-preview")>()), ensureBlurPreview: async (id: string) => void ensured.push(id) }));

const { setSubPostBlurLevel } = await import("@/lib/sub/posts");

beforeEach(() => {
  ops = [];
  deleted.length = 0;
  afterTasks.length = 0;
  ensured.length = 0;
  kicks.mockClear();
  missingColumn = false;
  current = { blur_level: "medium", blur_video_url: `${BASE}sub-blur/${POST}/0-old.mp4` };
  items = [{ blur_video_url: `${BASE}sub-blur/${POST}/0-old.mp4` }, { blur_video_url: `${BASE}uploads/x/1-old.webm` }, { blur_video_url: null }];
});

const updates = (table: string) => ops.filter((o) => o.op === "update" && o.table === table).map((o) => o.values);

describe("setSubPostBlurLevel", () => {
  it("Medium → Strong (same stored size): only the level changes — nothing cleared, nothing deleted, no worker", async () => {
    expect(await setSubPostBlurLevel(ME, POST, "strong")).toEqual({ ok: true, blurLevel: "strong", remaking: false });
    expect(updates("sub_posts")).toEqual([expect.objectContaining({ blur_level: "strong" })]);
    expect(updates("sub_post_media")).toEqual([]);
    expect(afterTasks).toHaveLength(0);
    expect(kicks).not.toHaveBeenCalled();
  });

  it("🔴 Medium → Light: the old stills and clips are cleared and their files deleted, then made again at the new size", async () => {
    expect(await setSubPostBlurLevel(ME, POST, "light")).toEqual({ ok: true, blurLevel: "light", remaking: true });
    expect(updates("sub_posts")).toEqual([expect.objectContaining({ blur_level: "light" }), { blur_preview: null, blur_video_url: null }]);
    expect(updates("sub_post_media")).toEqual([{ blur_preview: null, blur_video_url: null }]);
    expect(kicks).toHaveBeenCalledTimes(1);
    for (const t of afterTasks) await t();
    expect(deleted.sort()).toEqual([`sub-blur/${POST}/0-old.mp4`, "uploads/x/1-old.webm"]);
    expect(ensured).toEqual([POST]);
  });

  it("only the creator's own published post (every query is scoped to them)", async () => {
    await setSubPostBlurLevel(ME, POST, "strong");
    const read = ops.find((o) => o.op === "select" && o.table === "sub_posts")!;
    expect(read.filters).toEqual(expect.arrayContaining([["id", POST], ["creator_id", ME], ["status", "published"]]));
    current = null;
    expect(await setSubPostBlurLevel(ME, POST, "strong")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses anything but a level; before 0307 it answers 'arrives with the next update' (503)", async () => {
    expect(await setSubPostBlurLevel(ME, POST, "extreme")).toMatchObject({ ok: false, status: 400 });
    missingColumn = true;
    expect(await setSubPostBlurLevel(ME, POST, "light")).toMatchObject({ ok: false, status: 503 });
  });
});
