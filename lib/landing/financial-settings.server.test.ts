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

beforeEach(() => {
  db = fakeDb({ settings: [], config_audit_log: [] });
  db.unique.settings = [["key"]];
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
    // the settings upsert fails, the audit table still works
    (db as unknown as { client: () => unknown }).client = () => ({ ...client, from: (t: string) => (t === "settings" ? { ...(real(t) as object), upsert: async () => ({ data: null, error: { message: "disk full" } }) } : real(t)) });
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
