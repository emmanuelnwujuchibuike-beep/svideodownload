import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 3: who may read and change the conversion rules and the sticker catalogue. Reading needs an
 * administrator; any change (rates, fees, limits, sticker prices) needs an administrator with a fresh password
 * (requireFinancialAdmin). A refused change writes nothing. The database functions are scripted here — their own
 * behaviour is pinned in supabase/tests/0291_gift_settings_stickers.pglite.mjs.
 */
let db: FakeDb;
let admin: { id: string } | null = null;
let reauthed = false;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => reauthed }));

const settings = await import("@/app/api/admin/gift/settings/route");
const stickers = await import("@/app/api/admin/gift/stickers/route");
const artwork = await import("@/app/api/admin/gift/stickers/artwork/route");

const LEG_A = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const calls: string[] = [];

beforeEach(() => {
  db = fakeDb({ settings: [], financial_audit_log: [], gift_stickers: [] });
  admin = null;
  reauthed = false;
  calls.length = 0;
  db.rpc.save_frenz_gift_conversion = (a) => {
    calls.push("save_frenz_gift_conversion");
    const legs = a.p_legs as { fcToFgc: unknown; fgcToFc: unknown };
    if (a.p_expected_version !== 0) return { data: { ok: false, reason: "stale", version: 0 }, error: null };
    return { data: { ok: true, version: 1, conversion: { version: 1, ...legs } }, error: null };
  };
  db.rpc.admin_save_gift_sticker = (a) => {
    calls.push("admin_save_gift_sticker");
    const f = a.p_fields as Record<string, unknown>;
    return { data: { ok: true, changed: ["created"], sticker: { id: "00000000-0000-4000-8000-0000000000aa", slug: f.slug, name: f.name, price_fgc: f.priceFgc, rarity: "common", revision: 1, published: false, featured: false, sort_order: 0 } }, error: null };
  };
});

describe("/api/admin/gift/settings", () => {
  it("a member (not an administrator) can neither read nor save", async () => {
    expect((await settings.GET()).status).toBe(403);
    expect((await settings.POST(post({ fcToFgc: LEG_A, fgcToFc: LEG_B, expectedVersion: 0 }))).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("an administrator reads 'not configured' when nothing is stored", async () => {
    admin = { id: "admin-1" };
    const res = await settings.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ settings: { conversion: null }, summary: null });
  });
  it("saving needs a fresh password: refused, nothing saved, the refusal audited", async () => {
    admin = { id: "admin-1" };
    const res = await settings.POST(post({ fcToFgc: LEG_A, fgcToFc: LEG_B, expectedVersion: 0 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(calls).toEqual([]);
    expect(db.tables.financial_audit_log!.map((r) => r.action)).toEqual(["admin_step_up_required"]);
  });
  it("with a fresh password a valid rule set is saved as version 1, with the round-trip summary", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    const res = await settings.POST(post({ fcToFgc: LEG_A, fgcToFc: LEG_B, expectedVersion: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 1, summary: { roundTripPercent: "93.1000" } });
  });
  it("invalid rules never reach the database: refused with the reason, and the refusal audited", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    const res = await settings.POST(post({ fcToFgc: { ...LEG_A, feeBp: 0 }, fgcToFc: { ...LEG_B, feeBp: 0, feeFlat: 0 }, expectedVersion: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "invalid", detail: "config_arbitrage" });
    expect(calls).toEqual([]);
    expect(db.tables.financial_audit_log!.map((r) => r.action)).toEqual(["gift_conversion_config_rejected"]);
  });
  it("a stale version is answered 409, and the client can't send the version or extra fields", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    expect((await settings.POST(post({ fcToFgc: LEG_A, fgcToFc: LEG_B, expectedVersion: 3 }))).status).toBe(409);
    expect((await settings.POST(post({ fcToFgc: LEG_A, fgcToFc: LEG_B, expectedVersion: 0, version: 9 }))).status).toBe(400);
    expect((await settings.POST(post({ fcToFgc: { ...LEG_A, secret: 1 }, fgcToFc: LEG_B, expectedVersion: 0 }))).status).toBe(400);
  });
});

describe("/api/admin/gift/stickers", () => {
  it("a member can neither list, change, nor upload", async () => {
    expect((await stickers.GET(new Request("https://frenzsave.com/x"))).status).toBe(403);
    expect((await stickers.POST(post({ id: null, expectedRevision: null, fields: { slug: "rose", name: "Rose", priceFgc: 100 } }))).status).toBe(403);
    expect((await artwork.POST(new Request("https://frenzsave.com/x", { method: "POST", body: new FormData() }))).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("pricing a sticker needs a fresh password", async () => {
    admin = { id: "admin-1" };
    const res = await stickers.POST(post({ id: null, expectedRevision: null, fields: { slug: "rose", name: "Rose", priceFgc: 100 } }));
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("an invalid price is refused on the server before the database", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    for (const priceFgc of [0, -5, 100_000_000_000]) {
      const res = await stickers.POST(post({ id: null, expectedRevision: null, fields: { slug: "rose", name: "Rose", priceFgc } }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field: "priceFgc" });
    }
    expect((await stickers.POST(post({ id: null, expectedRevision: null, fields: { slug: "rose", name: "Rose", priceFgc: 1.5 } }))).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("a valid sticker is created through the audited function; an edit needs the revision it was made over", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    const res = await stickers.POST(post({ id: null, expectedRevision: null, fields: { slug: "rose", name: "Rose", priceFgc: 5000 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sticker: { slug: "rose", priceFgc: 5000, revision: 1 } });
    expect((await stickers.POST(post({ id: "00000000-0000-4000-8000-0000000000aa", expectedRevision: null, fields: { priceFgc: 6000 } }))).status).toBe(400);
    expect(calls).toEqual(["admin_save_gift_sticker"]);
  });
});
