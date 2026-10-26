import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 2 (M4): an admin action that moves money, or changes a money setting, needs a password re-entered in
 * the last ten minutes (lib/admin/financial-gate.ts, the same marker as requireSensitiveAdmin). Checked on the server;
 * a stale admin gets `REAUTH_REQUIRED` (the dashboard's sensitiveFetch prompts and replays), nothing changes, and the
 * refusal is on the financial audit log. Ordinary settings panels are not affected.
 */
let db: FakeDb;
let admin: { id: string } | null = { id: "admin-1" };
let reauthed = false;
const setLandingSettings = vi.fn(async () => {});
const financialChangesFor = vi.fn(async (): Promise<{ surface: string; keys: string[] }[]> => []);
const adjust = vi.fn(async () => 100);
const record = vi.fn(async () => ({ ok: true, id: "rev-1", state: "recovered", due: 1, recovered: 1, shortfall: 0, duplicate: false }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => reauthed }));
vi.mock("@/lib/landing/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/landing/settings")>()), setLandingSettings, financialChangesFor }));
vi.mock("@/lib/ai/character-replace/wallet", () => ({ adjustCharacterReplaceBalance: adjust }));
vi.mock("@/lib/ai/wallet/topup-reversals", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/wallet/topup-reversals")>()), recordAdminTopupReversal: record }));

const landing = await import("@/app/api/admin/landing/route");
const credit = await import("@/app/api/admin/ai/credit/route");
const reversals = await import("@/app/api/admin/wallet/topup-reversals/route");
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const audit = () => (db.tables.financial_audit_log ?? []).map((r) => r.action);

beforeEach(() => {
  db = fakeDb({ financial_audit_log: [], profiles: [{ id: "member-1", email: "m@t.test" }] });
  admin = { id: "admin-1" };
  reauthed = false;
  setLandingSettings.mockClear();
  financialChangesFor.mockReset();
  financialChangesFor.mockResolvedValue([]);
  adjust.mockClear();
  record.mockClear();
});

describe("/api/admin/landing", () => {
  it("a save that changes a money setting needs a fresh password: refused, nothing saved, refusal audited", async () => {
    financialChangesFor.mockResolvedValue([{ surface: "rewards", keys: ["sub"] }]);
    const res = await landing.POST(post({ frenzRewards: { sub: { withdrawalFeePercent: 6 } } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(setLandingSettings).not.toHaveBeenCalled();
    expect(audit()).toEqual(["admin_step_up_required"]);
  });
  it("with a fresh password it saves, with the admin's id", async () => {
    reauthed = true;
    financialChangesFor.mockResolvedValue([{ surface: "rewards", keys: ["sub"] }]);
    expect((await landing.POST(post({ frenzRewards: { sub: { withdrawalFeePercent: 6 } } }))).status).toBe(200);
    expect(setLandingSettings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changedBy: "admin-1" }));
  });
  it("an ordinary panel (nothing financial changes) saves WITHOUT a password prompt", async () => {
    expect((await landing.POST(post({ reelsPosterUrl: "" }))).status).toBe(200);
    expect(setLandingSettings).toHaveBeenCalledTimes(1);
    expect(audit()).toEqual([]);
  });
  it("a money save the writer refuses (its audit could not be written) is a 500 and is audited", async () => {
    reauthed = true;
    financialChangesFor.mockResolvedValue([{ surface: "ai_wallet", keys: ["transfers"] }]);
    setLandingSettings.mockRejectedValueOnce(new Error("financial settings audit could not be written"));
    expect((await landing.POST(post({ frenzAiPlans: {} }))).status).toBe(500);
    expect(audit()).toEqual(["admin_financial_settings_refused"]);
  });
  it("not an admin: 403, as before", async () => {
    admin = null;
    expect((await landing.POST(post({ reelsPosterUrl: "" }))).status).toBe(403);
  });
});

describe("/api/admin/ai/credit", () => {
  it("stale: refused before any balance moves", async () => {
    const res = await credit.POST(post({ email: "m@t.test", amountCents: 50, note: "goodwill" }));
    expect(res.status).toBe(403);
    expect(adjust).not.toHaveBeenCalled();
  });
  it("fresh: credited, and the action is audited with the admin's id", async () => {
    reauthed = true;
    expect((await credit.POST(post({ email: "m@t.test", amountCents: 50, note: "goodwill" }))).status).toBe(200);
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ actor_id: "admin-1", action: "admin_wallet_credited", target_id: "member-1" })]);
  });
});

describe("/api/admin/wallet/topup-reversals", () => {
  const body = { reference: "frenz_cr_topup_fw_0b8b1f5e-1111-4222-8333-444455556666", kind: "refund", idempotencyKey: "tr_0123456789", note: "Refunded in the dashboard" };
  it("stale: refused, nothing recorded", async () => {
    expect((await reversals.POST(post(body))).status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });
  it("fresh: recorded with the admin's id, and audited", async () => {
    reauthed = true;
    expect((await reversals.POST(post(body))).status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ adminId: "admin-1", idempotencyKey: "tr_0123456789", refundedMinor: null }));
    expect(audit()).toEqual(["admin_topup_reversal_recorded"]);
  });
  it("not a top-up reference: refused before the provider is asked", async () => {
    reauthed = true;
    expect((await reversals.POST(post({ ...body, reference: "frenz_sub_0123456789" }))).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
});
