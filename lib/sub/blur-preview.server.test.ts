import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * The locked-post preview (0263, owner 2026-10-18, REQUIRED): "Non-subscribers must NEVER receive the
 * original media for locked posts. Generate a heavily blurred, low-resolution preview on the server and
 * send only that." The preview itself is made by real sharp; who receives it is checked through the
 * real routes on an in-memory database. Every case asserts on what a response actually carries.
 */

let db: FakeDb;
let sessionUser: { id: string } | null = null;
const deferred: (() => unknown)[] = [];
const presignGet = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);

vi.mock("server-only", () => ({}));
// after() is collected, so a test can run the post-response work and see what it did
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void deferred.push(fn) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presignGet(k), presignPrivatePut: vi.fn(), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: { ...SUB_DEFAULTS } } }) };
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CREATOR = U(1);
const SUBSCRIBER = U(2);
const STRANGER = U(3); // follows the creator, does not subscribe
const POST = `10000000-0000-4000-8000-${"0".repeat(11)}1`;
const OLD = `10000000-0000-4000-8000-${"0".repeat(11)}2`;
const MATURE = `10000000-0000-4000-8000-${"0".repeat(11)}3`;
const BLUR = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASoBAAEAAQ==";
const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
const route = async (m: Promise<unknown>) => (await m) as Record<string, (r: Request) => Promise<Response>>;
const get = (url: string) => new Request(url, { method: "GET" });

/** A real photo-like image: a gradient with hard detail, so "no detail survives" means something. */
async function photo(): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const w = 600, h = 800, px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    px[i] = (x * 7) % 256; px[i + 1] = (y * 3) % 256; px[i + 2] = ((x ^ y) & 1) * 255;
  }
  return new Uint8Array(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer());
}

beforeEach(() => {
  sessionUser = null;
  deferred.length = 0;
  presignGet.mockClear();
  db = fakeDb({
    profiles: [CREATOR, SUBSCRIBER, STRANGER].map((id) => ({ id, handle: `h${id.slice(-1)}`, display_name: `P${id.slice(-1)}`, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false })),
    sub_posts: [
      { id: POST, creator_id: CREATOR, caption: "secret caption", cover_url: null, status: "published", audience: "locked", mature: false, blur_preview: BLUR, created_at: "2026-10-12T10:00:00Z" },
      { id: OLD, creator_id: CREATOR, caption: "older", cover_url: null, status: "published", audience: "locked", mature: false, blur_preview: null, created_at: "2026-10-11T10:00:00Z" },
      { id: MATURE, creator_id: CREATOR, caption: "mature", cover_url: null, status: "published", audience: "locked", mature: true, blur_preview: BLUR, created_at: "2026-10-10T10:00:00Z" },
    ],
    sub_post_media: [
      { id: "m1", post_id: POST, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/original.jpg`, thumb_key: `sub/${CREATOR}/thumb.jpg`, width: null, height: null },
      { id: "m2", post_id: OLD, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/old.jpg`, thumb_key: null, width: null, height: null },
      { id: "m3", post_id: MATURE, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/mature.jpg`, thumb_key: null, width: null, height: null },
    ],
    creator_memberships: [{ id: "mm", creator_id: CREATOR, member_id: SUBSCRIBER, status: "active", billing: "sub", period_end: future }],
    creator_membership_settings: [{ creator_id: CREATOR, sub_active: true, sub_price_cents: 500 }],
    age_checks: [],
    follows: [{ follower_id: STRANGER, following_id: CREATOR }],
    blocks: [],
    sub_purchases: [],
  });
});

describe("the preview itself", () => {
  it("is a tiny WebP data URL — 20 px wide, a few hundred bytes, the photo's detail gone", async () => {
    const { makeBlurPreview } = await import("./blur-preview");
    const src = await photo();
    const url = await makeBlurPreview(src);
    expect(url).toMatch(/^data:image\/webp;base64,/);
    expect(url!.length).toBeLessThan(1500);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(url!.split(",")[1]!, "base64")).metadata();
    expect(meta.width).toBe(20);
    // the source was ~600 × 800; what is stored can't hold more than 20 × 27 pixels of it
    expect(meta.height).toBeLessThanOrEqual(27);
  });

  it("isn't made from something that isn't an image", async () => {
    const { makeBlurPreview } = await import("./blur-preview");
    expect(await makeBlurPreview(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("who receives it", () => {
  const gallery = async () => {
    const r = await route(import("@/app/api/sub/posts/route"));
    return (await (await r.GET!(get(`https://frenzsave.com/api/sub/posts?creator=${CREATOR}`))).json()) as { posts: Record<string, unknown>[]; access: boolean };
  };

  it("a non-subscriber gets the blurred preview — and nothing of the file: no key, no link, no caption", async () => {
    sessionUser = { id: STRANGER };
    const out = await gallery();
    const p = out.posts.find((x) => x.id === POST)!;
    expect(p.blurUrl).toBe(BLUR);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/original\.jpg|thumb\.jpg|old\.jpg|mature\.jpg|sig=1|secret caption/);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("signed out, the same", async () => {
    const out = await gallery();
    expect(out.posts.find((x) => x.id === POST)!.blurUrl).toBe(BLUR);
    expect(presignGet).not.toHaveBeenCalled();
  });

  /*
    Owner, 2026-10-29: "the 18+ and all exclusive should auto play … blurred on unsubscriber, nothing less than that, no
    optionals". The BLURRED preview of a Mature post now goes to every non-subscriber (a 20 px still holds nothing to
    recover); its caption, and the file, still never reach a viewer who hasn't confirmed 18+.
  */
  it("a Mature post's blurred preview goes to every non-subscriber — its caption and file never do", async () => {
    sessionUser = { id: STRANGER };
    const before = (await gallery()).posts.find((x) => x.id === MATURE)!;
    expect(before.blurUrl).toBe(BLUR);
    expect(before.caption ?? null).toBeNull();
    expect(JSON.stringify(before)).not.toMatch(/mature\.jpg|"caption":"mature"/);
    db.tables.age_checks!.push({ user_id: STRANGER, result: "adult", method: "self_declared_dob", eligible_on: null });
    expect((await gallery()).posts.find((x) => x.id === MATURE)!.blurUrl).toBe(BLUR);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("a subscriber gets the real (signed) thumb, not the blur", async () => {
    sessionUser = { id: SUBSCRIBER };
    const p = (await gallery()).posts.find((x) => x.id === POST)!;
    expect(p.blurUrl).toBeUndefined();
    expect(String(p.thumbUrl)).toMatch(/thumb\.jpg\?sig=1/);
  });

  it("discover shows a follower the blurred preview too", async () => {
    sessionUser = { id: STRANGER };
    const r = await route(import("@/app/api/sub/feed/route"));
    const out = (await (await r.GET!(get("https://frenzsave.com/api/sub/feed"))).json()) as { discover?: { cards: Record<string, unknown>[] } };
    const card = out.discover?.cards.find((c) => c.id === POST);
    expect(card?.blurUrl).toBe(BLUR);
    expect(JSON.stringify(out)).not.toMatch(/original\.jpg|thumb\.jpg|sig=1/);
  });
});

describe("making it", () => {
  it("the creator's visit fills in an older post's preview after the response — once, from the private file", async () => {
    const bytes = await photo();
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array(bytes)]))) as unknown as typeof fetch;
    try {
      sessionUser = { id: CREATOR };
      const r = await route(import("@/app/api/sub/posts/route"));
      await r.GET!(get(`https://frenzsave.com/api/sub/posts?creator=${CREATOR}`));
      for (const fn of deferred.splice(0)) await fn();
      const old = db.tables.sub_posts!.find((p) => p.id === OLD)!;
      expect(String(old.blur_preview)).toMatch(/^data:image\/webp;base64,/);
      // made from the private file through a short-lived link, never stored as one
      expect(presignGet.mock.calls.map((c) => c[0])).toContain(`sub/${CREATOR}/old.jpg`);
      expect(String(old.blur_preview)).not.toMatch(/old\.jpg|https?:/);
      // an existing preview is never replaced
      expect(db.tables.sub_posts!.find((p) => p.id === POST)!.blur_preview).toBe(BLUR);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
