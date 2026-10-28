import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 2 (M4 / M5): money settings ride in the same `landing` row as every other panel.
 *   · `financialChanges` says which money sections a save changes (rewards: reward rules, withdrawal rates, every SUB
 *     money setting; ai_wallet: packs, transfer fees, routing, the deposit minimum) — after normalisation, ignoring
 *     bookkeeping — so the admin route asks for a fresh password only then.
 *   · `setLandingSettings` writes the audit row FIRST, awaited; no audit → nothing saved. A failed save is no longer
 *     reported as a success, and a save that fails after its audit row leaves a `settings.update.failed` row.
 *   · the rewards version now bumps when a SUB money setting changes.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));

const load = async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  return import("./settings");
};

/**
 * 0291 save_landing_settings, as the database runs it: stored || (value - frenzGift). The landing row's only writer.
 * Logged as a "settings" write like the upsert it replaced.
 */
export function scriptLandingSave(d: FakeDb) {
  d.rpc.save_landing_settings = ({ p_value }) => {
    const { frenzGift: _ignored, ...sent } = p_value as Record<string, unknown>;
    d.tables.settings ??= [];
    const row = d.tables.settings.find((r) => r.key === "landing");
    if (row) row.value = { ...(row.value as Record<string, unknown>), ...sent };
    else d.tables.settings.push({ key: "landing", value: sent });
    d.writes.push({ table: "settings", op: "upsert", values: sent, filters: [] });
    return { data: null, error: null };
  };
}

beforeEach(() => {
  db = fakeDb({ settings: [], config_audit_log: [] });
  db.unique.settings = [["key"]];
  scriptLandingSave(db);
});

describe("financialChanges (pure)", () => {
  it("re-posting what is stored changes nothing; bookkeeping never counts", async () => {
    const s = await load();
    const cur = await s.getLandingSettings();
    expect(s.financialChanges(cur, cur)).toEqual([]);
    expect(s.financialChanges(cur, { ...cur, frenzRewards: { ...cur.frenzRewards, version: cur.frenzRewards.version + 1, updatedAt: "2030-01-01" } })).toEqual([]);
  });
  it("a withdrawal fee, a SUB flat-fee tier, the payout provider and a transfer fee are financial", async () => {
    const s = await load();
    const cur = await s.getLandingSettings();
    const w = s.financialChanges(cur, { ...cur, frenzRewards: { ...cur.frenzRewards, withdrawals: { ...cur.frenzRewards.withdrawals, deposited: { ...cur.frenzRewards.withdrawals.deposited, feePercent: 6 } } } });
    expect(w).toEqual([expect.objectContaining({ surface: "rewards", keys: ["withdrawals"] })]);
    const sub = s.financialChanges(cur, { ...cur, frenzRewards: { ...cur.frenzRewards, sub: { ...cur.frenzRewards.sub, payoutProvider: "paystack", flatFees: { ...cur.frenzRewards.sub.flatFees, overCents: 500 } } } });
    expect(sub[0]).toMatchObject({ surface: "rewards", keys: ["sub"] });
    expect((sub[0]!.after.sub as { payoutProvider: string }).payoutProvider).toBe("paystack");
    const t = s.financialChanges(cur, { ...cur, frenzAiPlans: { ...cur.frenzAiPlans, wallet: { ...cur.frenzAiPlans.wallet, transfers: { ...cur.frenzAiPlans.wallet.transfers, feePercent: 10 } } } });
    expect(t).toEqual([expect.objectContaining({ surface: "ai_wallet", keys: ["transfers"] })]);
    expect(s.financialChanges(cur, { ...cur, frenzAiMinTopupCents: cur.frenzAiMinTopupCents + 100 })).toEqual([expect.objectContaining({ surface: "ai_wallet", keys: ["minTopupCents"] })]);
  });
  it("an unrelated panel (the reels poster, an AI price list) is not financial", async () => {
    const s = await load();
    expect(await s.financialChangesFor({ reelsPosterUrl: "" })).toEqual([]);
    expect(await s.financialChangesFor({ frenzAiPlans: {} })).toEqual([]);
  });
});

describe("setLandingSettings: the audit row first", () => {
  it("a financial change writes its audit row with the admin's id BEFORE the settings row", async () => {
    const s = await load();
    await s.setLandingSettings({ frenzRewards: { sub: { withdrawalFeePercent: 6 } } as never }, { changedBy: "admin-1" });
    const order = db.writes.filter((w) => w.table === "config_audit_log" || w.table === "settings").map((w) => w.table);
    expect(order[0]).toBe("config_audit_log");
    expect(order).toContain("settings");
    const row = db.tables.config_audit_log!.find((r) => r.surface === "rewards")!;
    expect(row).toMatchObject({ actor_id: "admin-1", action: "settings.update" });
    expect(((row.after as { sub: { withdrawalFeePercent: number } }).sub).withdrawalFeePercent).toBe(6);
    expect(JSON.stringify(row)).not.toMatch(/secret|password|token/i);
  });
  it("no audit row → nothing is saved, and the caller is told", async () => {
    const s = await load();
    db.failOn.config_audit_log = "relation unavailable";
    await expect(s.setLandingSettings({ frenzRewards: { sub: { withdrawalFeePercent: 6 } } as never }, { changedBy: "admin-1" })).rejects.toThrow(/audit/);
    expect(db.writes.some((w) => w.table === "settings")).toBe(false);
  });
  it("a failed save is no longer reported as a success, and leaves a settings.update.failed row", async () => {
    const s = await load();
    const client = db.client() as { from: (t: string) => unknown };
    const real = client.from.bind(client);
    // the settings write fails (0291: the save_landing_settings call), the audit table still works
    void real;
    db.rpc.save_landing_settings = () => ({ data: null, error: { message: "disk full" } });
    await expect(s.setLandingSettings({ frenzRewards: { sub: { withdrawalFeePercent: 6 } } as never }, { changedBy: "admin-1" })).rejects.toThrow(/could not be saved/);
    expect(db.tables.config_audit_log!.map((r) => r.action)).toEqual(["settings.update", "settings.update.failed"]);
  });
  it("a non-financial change saves without a financial audit row", async () => {
    const s = await load();
    await s.setLandingSettings({ reelsPosterUrl: "" }, { changedBy: "admin-1" });
    expect(db.tables.config_audit_log!.filter((r) => r.surface === "rewards" || r.surface === "ai_wallet")).toEqual([]);
    expect(db.writes.some((w) => w.table === "settings")).toBe(true);
  });
});

describe("Frenz Coin settings (Part 3)", () => {
  it("ship off, with the confirmed fee schedule, and every coin rule is a money setting (surface frenz_coin)", async () => {
    const s = await load();
    const cur = await s.getLandingSettings();
    expect(cur.frenzCoin).toMatchObject({ enabled: false, currency: "USD", transfers: { percentBp: 1_000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500 }, withdrawals: { percentBp: 600, flatCents: 0 } });
    const next = { ...cur, frenzCoin: { ...cur.frenzCoin, transfers: { ...cur.frenzCoin.transfers, flatMidCents: 25 } } };
    expect(s.financialChanges(cur, next)).toEqual([expect.objectContaining({ surface: "frenz_coin", keys: ["transfers"] })]);
    expect(await s.financialChangesFor({ frenzCoin: { withdrawals: { percentBp: 600 } } })).toEqual([]);
    expect(await s.financialChangesFor({ frenzCoin: { withdrawals: { percentBp: 700 } } })).toEqual([expect.objectContaining({ surface: "frenz_coin" })]);
  });
  it("Wallet setup (2026-10-26): a payout-rate change is audited with the OLD and NEW rate, by the admin, before it is saved", async () => {
    const s = await load();
    await s.setLandingSettings({ frenzCoin: { withdrawals: { payoutRateSource: "fixed", payoutMinorPerUsd: 155_000 } } }, { changedBy: "admin-1" });
    expect(db.writes.find((w) => w.table === "config_audit_log" || w.table === "settings")?.table).toBe("config_audit_log");
    const row = db.tables.config_audit_log!.find((r) => r.surface === "frenz_coin")!;
    expect(row).toMatchObject({ actor_id: "admin-1", before: { withdrawals: { payoutRateSource: "none", payoutMinorPerUsd: null } }, after: { withdrawals: { payoutRateSource: "fixed", payoutMinorPerUsd: 155_000 } } });
    // server-side bounds: a rate that is not a positive whole number of kobo is never stored — it fails CLOSED to "no
    // approved rate" (payouts refused), never to a usable number. The admin route's own schema refuses it first (min 1).
    await s.setLandingSettings({ frenzCoin: { withdrawals: { payoutMinorPerUsd: -5 } } }, { changedBy: "admin-1" });
    const saved = (db.tables.settings![0]!.value as { frenzCoin: { withdrawals: { payoutMinorPerUsd: number | null } } }).frenzCoin.withdrawals;
    expect(saved.payoutMinorPerUsd).toBeNull();
    const route = readFileSync(join(process.cwd(), "app/api/admin/landing/route.ts"), "utf8");
    expect(route).toContain("payoutMinorPerUsd: z.number().int().min(1).max(999_999_999).nullable().optional()");
  });

  it("a coin change is audited FIRST and bumps the coin version; no audit → not saved", async () => {
    const s = await load();
    await s.setLandingSettings({ frenzCoin: { enabled: true } }, { changedBy: "admin-1" });
    expect(db.writes.find((w) => w.table === "config_audit_log" || w.table === "settings")?.table).toBe("config_audit_log");
    const row = db.tables.config_audit_log!.find((r) => r.surface === "frenz_coin")!;
    expect(row).toMatchObject({ actor_id: "admin-1", before: { enabled: false }, after: { enabled: true } });
    const saved = (db.tables.settings![0]!.value as { frenzCoin: { enabled: boolean; version: number } }).frenzCoin;
    expect(saved).toMatchObject({ enabled: true, version: 2 });
    db.failOn.config_audit_log = "relation unavailable";
    const fresh = await load();
    await expect(fresh.setLandingSettings({ frenzCoin: { enabled: false } }, { changedBy: "admin-1" })).rejects.toThrow(/audit/);
  });
});

describe("versioning", () => {
  it("a SUB money setting now bumps the rewards version (it did not before Part 2)", async () => {
    const { versionRewardsConfig, normalizeRewardsConfig } = await import("@/lib/rewards/config");
    const a = normalizeRewardsConfig({});
    const b = normalizeRewardsConfig({ sub: { withdrawalFeePercent: a.sub.withdrawalFeePercent + 1 } });
    expect(versionRewardsConfig(a, b).version).toBe(a.version + 1);
    expect(versionRewardsConfig(a, a).version).toBe(a.version);
  });
});

describe("Frenz Gift Coin Part 3 (0291): saving any other settings never loses frenzGift", () => {
  const GIFT = {
    conversion: {
      version: 4,
      fcToFgc: { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 },
      fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 },
    },
    updatedAt: "2026-10-27T10:00:00Z",
    updatedBy: "admin-9",
  };
  const seed = () => db.tables.settings!.push({ key: "landing", value: { frenzGift: GIFT, futureSection: { keep: true }, reelsPosterUrl: "" } });
  const stored = () => db.tables.settings!.find((r) => r.key === "landing")!.value as Record<string, unknown>;

  it("reads the stored rules, or 'not configured' — never a guessed value", async () => {
    let s = await load();
    expect((await s.getLandingSettings()).frenzGift).toEqual({ conversion: null, problem: null, updatedAt: null, updatedBy: null, gifting: null, giftingProblem: null, giftingUpdatedAt: null, giftingUpdatedBy: null });
    seed();
    s = await load();
    const g = (await s.getLandingSettings()).frenzGift;
    expect(g.conversion?.version).toBe(4);
    expect(g.updatedBy).toBe("admin-9");
  });
  it("a stored value that fails the rules check is reported and treated as not configured (never repaired)", async () => {
    db.tables.settings!.push({ key: "landing", value: { frenzGift: { conversion: { ...GIFT.conversion, fcToFgc: { ...GIFT.conversion.fcToFgc, feeBp: 0 }, fgcToFc: { ...GIFT.conversion.fgcToFc, feeBp: 0, feeFlat: 0 } } } } });
    const g = (await (await load()).getLandingSettings()).frenzGift;
    expect(g.conversion).toBeNull();
    expect(g.problem).toMatch(/round trip/);
  });
  it.each([
    ["the landing panel", { reelsPosterUrl: "https://example.test/p.webp" }],
    ["a Frenz Coin setting", { frenzCoin: { enabled: true } }],
    ["a reward setting", { frenzRewards: { sub: { withdrawalFeePercent: 6 } } }],
    ["an AI price", { frenzAiVideoPriceCents: 75 }],
  ])("saving %s keeps frenzGift and unknown keys exactly", async (_, patch) => {
    seed();
    const s = await load();
    await s.setLandingSettings(patch as never, { changedBy: "admin-1" });
    expect(stored().frenzGift).toEqual(GIFT);
    expect(stored().futureSection).toEqual({ keep: true });
  });
  it("a patch that smuggles frenzGift in cannot change it", async () => {
    seed();
    const s = await load();
    await s.setLandingSettings({ reelsPosterUrl: "", frenzGift: { conversion: null } } as never, { changedBy: "admin-1" });
    expect(stored().frenzGift).toEqual(GIFT);
  });
  it("frenzGift is not a money section of setLandingSettings (its own audited writer records it)", async () => {
    seed();
    const s = await load();
    await s.setLandingSettings({ reelsPosterUrl: "" }, { changedBy: "admin-1" });
    expect(db.tables.config_audit_log!.filter((r) => r.surface === "frenz_gift")).toEqual([]);
  });
  it("before 0291 has run (the function is missing) the fallback still keeps frenzGift and unknown keys", async () => {
    seed();
    db.rpc.save_landing_settings = () => ({ data: null, error: { message: "Could not find the function public.save_landing_settings(p_value) in the schema cache", code: "PGRST202" } });
    const s = await load();
    await s.setLandingSettings({ reelsPosterUrl: "https://example.test/q.webp", frenzCoin: { enabled: true } }, { changedBy: "admin-1" });
    expect(stored().frenzGift).toEqual(GIFT);
    expect(stored().futureSection).toEqual({ keep: true });
    expect(stored().reelsPosterUrl).toBe("https://example.test/q.webp");
  });
  it("any other write failure is reported, not retried as the fallback", async () => {
    seed();
    db.rpc.save_landing_settings = () => ({ data: null, error: { message: "permission denied" } });
    const s = await load();
    await expect(s.setLandingSettings({ reelsPosterUrl: "" }, { changedBy: "admin-1" })).rejects.toThrow(/could not be saved/);
    expect(db.writes.some((w) => w.table === "settings")).toBe(false);
  });
});
