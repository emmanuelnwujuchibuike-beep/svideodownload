import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 2 (H3): an account deletion never loses a member's money and never erases financial history.
 *   request  refused (409, with the reasons) while money is held or moving — account_financial_blockers
 *   purge    retain_financial_records first; anything but a clean answer keeps the account for the next run
 * The SQL (blockers, redaction, the dropped cascades, the five deletion cases) is proven in
 * supabase/tests/0278_financial_safety.pglite.mjs.
 */
let db: FakeDb;
const user = { id: "00000000-0000-4000-8000-000000000001" };
const deleteUser = vi.fn(async () => ({ error: null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: async () => {} }));
vi.mock("@/lib/cron/auth", () => ({ cronAuthorized: async () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ ...(db.client() as object), auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ ...(db.client() as object), auth: { admin: { deleteUser } } }) }));

const request = await import("./route");
const purge = await import("@/app/api/cron/purge-deleted-accounts/route");
const long = new Date(Date.now() - 40 * 864e5).toISOString();

beforeEach(() => {
  db = fakeDb({ profiles: [{ id: user.id, deletion_requested_at: null }] });
  deleteUser.mockClear();
});

describe("POST /api/account/delete", () => {
  it("money held or moving: refused with the member's reasons, nothing scheduled", async () => {
    db.rpc.account_financial_blockers = () => ({ data: { ok: false, reasons: ["withdrawable_balance", "open_withdrawal"], tokens: 0 }, error: null });
    const res = await request.POST(new Request("https://frenzsave.com/api/account/delete", { method: "POST" }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { reasons: string[] };
    expect(json.reasons).toHaveLength(2);
    expect(db.tables.profiles![0]!.deletion_requested_at).toBeNull();
  });
  it("nothing held: scheduled as before", async () => {
    db.rpc.account_financial_blockers = () => ({ data: { ok: true, reasons: [], tokens: 12 }, error: null });
    expect((await request.POST(new Request("https://frenzsave.com/api/account/delete", { method: "POST" }))).status).toBe(200);
    expect(db.tables.profiles![0]!.deletion_requested_at).toEqual(expect.any(String));
  });
  it("the check could not run: the REQUEST is accepted (the purge checks again and never proceeds without it)", async () => {
    db.rpc.account_financial_blockers = () => ({ data: null, error: { message: "connection reset" } });
    expect((await request.POST(new Request("https://frenzsave.com/api/account/delete", { method: "POST" }))).status).toBe(200);
  });
});

describe("the purge", () => {
  beforeEach(() => {
    db.tables.profiles = [{ id: user.id, deletion_requested_at: long }];
  });
  it("records retained and nothing blocks: purged", async () => {
    db.rpc.retain_financial_records = () => ({ data: { ok: true, tokens_closed: 0, withdrawals_redacted: 1 }, error: null });
    expect(await (await purge.GET(new Request("https://frenzsave.com/api/cron/purge-deleted-accounts"))).json()).toMatchObject({ purged: 1, held: 0 });
    expect(deleteUser).toHaveBeenCalledWith(user.id);
  });
  it("money still held: the account is kept for the next run", async () => {
    db.rpc.retain_financial_records = () => ({ data: { ok: false, reason: "blocked", reasons: ["sub_balance"] }, error: null });
    expect(await (await purge.GET(new Request("https://frenzsave.com/api/cron/purge-deleted-accounts"))).json()).toMatchObject({ purged: 0, held: 1 });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("0278 not run yet, or an error: kept (never purged on an unknown)", async () => {
    db.rpc.retain_financial_records = () => ({ data: null, error: { message: "function public.retain_financial_records does not exist" } });
    expect(await (await purge.GET(new Request("https://frenzsave.com/api/cron/purge-deleted-accounts"))).json()).toMatchObject({ purged: 0, held: 1 });
    db.rpc.retain_financial_records = () => ({ data: null, error: { message: "timeout" } });
    await purge.GET(new Request("https://frenzsave.com/api/cron/purge-deleted-accounts"));
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
