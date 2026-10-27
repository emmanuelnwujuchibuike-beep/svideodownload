import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Stories Part 5 (2026-10-27) — performance, measured over the REAL lib/social/stories.ts and an in-memory database:
 *   · round trips: a query's "wave" is 1 + the highest wave that had finished when it started. Home's ring read is
 *     3 sequential round trips (ties + blocks + discovery → tied authors' stories → profiles + views); it was 4, the
 *     discovery read waiting on the tied authors' stories for no reason;
 *   · the column fallback: with a migration unapplied (a missing column), the first read pays the failed query and
 *     later reads start from the column set that worked — it used to fail and retry on EVERY read;
 *   · and the access rules did not move: a blocked author and a followers-only stranger stay out.
 */
let db: FakeDb;
let completedWave = 0;
let maxWave = 0;
let failColumn: string | null = null;
let storiesSelects: string[] = [];

/** Every awaited query resolves on a later macrotask, so queries started together really are one wave. */
function instrument(builder: unknown): unknown {
  if (!builder || typeof builder !== "object") return builder;
  return new Proxy(builder as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === "then") {
        const wave = completedWave + 1;
        maxWave = Math.max(maxWave, wave);
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          (target.then as (a: (v: unknown) => unknown) => Promise<unknown>)
            .call(target, (v: unknown) => new Promise((r) => setTimeout(() => {
              completedWave = Math.max(completedWave, wave);
              r(v);
            }, 1)))
            .then(res, rej);
      }
      const v = target[prop as string];
      return typeof v === "function" ? (...args: unknown[]) => instrument((v as (...a: unknown[]) => unknown).apply(target, args)) : v;
    },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const real = db.client() as { from: (t: string) => { select: (c: string) => unknown } };
    return {
      ...real,
      from: (t: string) => {
        const b = real.from(t);
        if (t !== "stories") return instrument(b);
        return instrument({
          ...b,
          select: (cols: string) => {
            storiesSelects.push(cols);
            if (failColumn && cols.includes(failColumn)) {
              const failed = { data: null, error: { message: `column stories.${failColumn} does not exist (42703)` } };
              const chain: Record<string, unknown> = {};
              for (const m of ["gt", "eq", "in", "order", "range", "limit"]) chain[m] = () => chain;
              chain.then = (res: (v: unknown) => unknown) => Promise.resolve(failed).then(res);
              return chain;
            }
            return (b as { select: (c: string) => unknown }).select(cols);
          },
        });
      },
    };
  },
}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
const { getActiveStories } = await import("./stories");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const FRIEND = U(2);
const BLOCKER = U(3);
const FOLLOWERS_ONLY = U(4);
const STRANGER = U(5);
const future = () => new Date(Date.now() + 20 * 3_600_000).toISOString();
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
let sid = 0;
const story = (user_id: string, m: number) => ({ id: `s${++sid}`, user_id, media_url: `https://media.test/${sid}.jpg`, media_kind: "image", caption: null, created_at: ago(m), expires_at: future(), allow_reshare: true, thumbnail_url: null, allow_replies: true });
const profile = (id: string, handle: string, visibility = "public") => ({ id, handle, display_name: handle, avatar_url: null, is_verified: false, visibility, is_suspended: false, is_hidden: false });

beforeEach(() => {
  completedWave = 0;
  maxWave = 0;
  failColumn = null;
  storiesSelects = [];
  sid = 0;
  const [lo, hi] = ME < FRIEND ? [ME, FRIEND] : [FRIEND, ME];
  db = fakeDb({
    profiles: [profile(ME, "me"), profile(FRIEND, "friend"), profile(BLOCKER, "blocker"), profile(FOLLOWERS_ONLY, "fo", "followers"), profile(STRANGER, "stranger")],
    friendships: [{ user_low: lo, user_high: hi }],
    follows: [],
    conversations: [],
    blocks: [{ blocker_id: BLOCKER, blocked_id: ME }],
    user_restrictions: [],
    story_views: [],
    stories: [story(ME, 3), story(FRIEND, 10), story(BLOCKER, 1), story(FOLLOWERS_ONLY, 2), story(STRANGER, 4)],
  });
});

describe("Home's ring read — round trips", () => {
  it("is 3 sequential round trips (discovery no longer waits for the tied authors' stories)", async () => {
    const groups = await getActiveStories(ME, 50, "all");
    expect(groups.map((g) => g.handle).sort()).toEqual(["friend", "me", "stranger"]);
    expect(maxWave).toBe(3);
  });

  it("the access rules did not move with it: a blocker and a followers-only stranger stay out", async () => {
    const hs = (await getActiveStories(ME, 50, "all")).map((g) => g.handle);
    expect(hs).not.toContain("blocker");
    expect(hs).not.toContain("fo");
  });

  it("teeth: the wave counter really counts sequential awaits", async () => {
    const client = (await import("@/lib/supabase/admin")).createAdminClient() as unknown as { from: (t: string) => { select: (c: string) => PromiseLike<unknown> } };
    maxWave = 0;
    completedWave = 0;
    await client.from("profiles").select("id");
    await client.from("profiles").select("id");
    expect(maxWave).toBe(2);
  });
});

describe("the missing-column fallback is remembered", () => {
  it("the first read pays the failed query; the next starts from the column set that worked", async () => {
    failColumn = "allow_replies";
    await getActiveStories(ME, 50, "all");
    const firstRead = storiesSelects.length;
    expect(storiesSelects.filter((c) => c.includes("allow_replies")).length).toBeGreaterThan(0);
    storiesSelects = [];
    const groups = await getActiveStories(ME, 50, "all");
    expect(groups.length).toBeGreaterThan(0);
    // no query asked for the missing column again, and the second read made fewer stories queries than the first
    expect(storiesSelects.some((c) => c.includes("allow_replies"))).toBe(false);
    expect(storiesSelects.length).toBeLessThan(firstRead);
  });
});
