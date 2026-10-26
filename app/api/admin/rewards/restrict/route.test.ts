import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4.1 — the ACCOUNT-WIDE financial restriction (reward_profiles.restricted) is set only through this
 * route: an administrator, a fresh password, and a financial_audit_log row for the decision.
 */
let db: FakeDb;
let admin: { id: string } | null;
let fresh = true;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => fresh }));

const { POST } = await import("./route");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown) => new Request("https://frenzsave.com/api/admin/rewards/restrict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  admin = { id: "admin-1" };
  fresh = true;
  db = fakeDb({ profiles: [{ id: MEMBER, email: "m@t.test" }], reward_profiles: [], financial_audit_log: [] });
  db.unique.reward_profiles = [["user_id"]];
});

describe("POST /api/admin/rewards/restrict", () => {
  it("not an administrator: 403, nothing written", async () => {
    admin = null;
    expect((await POST(req({ email: "m@t.test", restricted: true }))).status).toBe(403);
    expect(db.tables.reward_profiles).toEqual([]);
  });
  it("no fresh password: REAUTH_REQUIRED, nothing written (the attempt is audited)", async () => {
    fresh = false;
    const res = await POST(req({ email: "m@t.test", restricted: true, reason: "fraud" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(db.tables.reward_profiles).toEqual([]);
    expect(db.tables.financial_audit_log!.map((r) => r.action)).toEqual(["admin_step_up_required"]);
  });
  it("restricts the account and records who decided it", async () => {
    expect((await POST(req({ email: "m@t.test", restricted: true, reason: "fraud review" }))).status).toBe(200);
    expect(db.tables.reward_profiles![0]).toMatchObject({ user_id: MEMBER, restricted: true, restricted_reason: "fraud review", restricted_by: "admin-1" });
    expect(db.tables.financial_audit_log!.find((r) => r.action === "admin_account_restricted")).toMatchObject({ actor_id: "admin-1", target_id: MEMBER, details: { restricted: true, scope: "account" } });
  });
  it("clearing it is audited too", async () => {
    await POST(req({ email: "m@t.test", restricted: true, reason: "x" }));
    await POST(req({ email: "m@t.test", restricted: false }));
    expect(db.tables.reward_profiles![0]).toMatchObject({ restricted: false, restricted_reason: null });
    expect(db.tables.financial_audit_log!.some((r) => r.action === "admin_account_restriction_cleared")).toBe(true);
  });
});
