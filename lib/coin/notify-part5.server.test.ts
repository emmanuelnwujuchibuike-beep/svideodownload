import { beforeEach, describe, expect, it, vi } from "vitest";

import { COIN_DEFAULTS, type CoinAdminAlerts } from "@/lib/coin/config";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 5 (owner, 2026-10-25: "users and admin receive email and push of every transaction … admin should get
 * an additional push or email depending on the one set by admin … the profit which is the fees"). Pinned:
 *   · every member money notice also sends ONE receipt email (kind coin_transaction), under the same claim as the push;
 *   · the admins hear about a transfer / withdrawal with the fee earned — by push, email, both, or not at all, as
 *     frenzCoin.adminAlerts says — and only once per event;
 *   · a transfer tells BOTH members (each their own receipt) and names the other side by public name only.
 */
let db: FakeDb;
let channel: CoinAdminAlerts = "both";
const push = vi.fn(async (..._a: unknown[]) => {});
const adminPush = vi.fn(async (..._a: unknown[]) => {});
const adminEmail = vi.fn(async (..._a: unknown[]) => true);
const memberEmail = vi.fn(async (..._a: unknown[]) => "sent" as const);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: (...a: unknown[]) => push(...a) }));
vi.mock("@/lib/email/resend", () => ({ hasResend: true, sendProductEmail: vi.fn(async () => true) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: (...a: unknown[]) => memberEmail(...a) }));
vi.mock("@/lib/push/web-push", () => ({ sendPushToUser: (...a: unknown[]) => adminPush(...a) }));
vi.mock("@/lib/notify", () => ({ sendAdminEmail: (...a: unknown[]) => adminEmail(...a), alertEmailHtml: (o: unknown) => JSON.stringify(o) }));
vi.mock("@/lib/support/chat", () => ({ resolveAdminUserIds: async () => ["admin-1", "admin-2"] }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzCoin: { ...COIN_DEFAULTS, enabled: true, adminAlerts: channel } }) }));

const notify = await import("./notify");
const server = await import("./server");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";
const recent = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  db = fakeDb({
    coin_notification_claims: [],
    profiles: [
      { id: A, handle: "ada", display_name: "Ada", email: "ada@example.com" },
      { id: B, handle: "bo", display_name: "Bo", email: "bo@example.com" },
    ],
    ai_product_ledger: [{ id: "l1", user_id: B, product: "frenz_coin", kind: "transfer_in", reference: `coin-transfer:${T}`, notified_at: null }],
    coin_deposits: [],
    withdrawal_requests: [{ id: "w1", user_id: A, source: "coin", status: "completed", gross_cents: 10_000, fee_cents: 600, net_cents: 9_400, updated_at: recent }],
  });
  db.unique.coin_notification_claims = [["key"]];
  channel = "both";
  for (const f of [push, adminPush, adminEmail, memberEmail]) f.mockClear();
});

const alert = { kind: "transfer" as const, title: "Coin transfer — $50.00 (fee $6.00)", summary: "Ada sent $50.00 to Bo", rows: [{ label: "Amount", value: "$50.00" }], feeCents: 600 };

describe("member receipts by email", () => {
  it("a money notice sends its receipt once, with the push, as a transactional coin email", async () => {
    const e = { subject: "Deposit received", heading: "Deposit received", intro: "x" };
    expect(await notify.notifyCoin(A, "coin-deposit-held:r1", "coin_deposit_update", { title: "t", body: "b", genericBody: "g" }, { email: e })).toBe(true);
    expect(await notify.notifyCoin(A, "coin-deposit-held:r1", "coin_deposit_update", { title: "t", body: "b", genericBody: "g" }, { email: e })).toBe(false);
    expect(memberEmail).toHaveBeenCalledTimes(1);
    expect(memberEmail.mock.calls[0]?.[0]).toBe(A);
    expect(memberEmail.mock.calls[0]?.[2]).toBe("coin_transaction");
  });
  it("a failed email never throws and never un-sends the push", async () => {
    memberEmail.mockRejectedValueOnce(new Error("mail down"));
    expect(await notify.notifyCoin(A, "k-mail", "coin_deposit_update", { title: "t", body: "b", genericBody: "g" }, { email: { subject: "s", heading: "h", intro: "i" } })).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("admin alerts — the channel the admin set, once, with the fee", () => {
  it.each([
    ["both", 2, 1],
    ["push", 2, 0],
    ["email", 0, 1],
    ["off", 0, 0],
  ] as const)("adminAlerts=%s → %i admin pushes, %i admin emails", async (c, pushes, mails) => {
    channel = c;
    await notify.notifyCoinAdmins("coin-transfer:x", A, alert);
    expect(adminPush).toHaveBeenCalledTimes(pushes);
    expect(adminEmail).toHaveBeenCalledTimes(mails);
  });
  it("the fee earned is in the push and the email", async () => {
    await notify.notifyCoinAdmins("coin-transfer:x", A, alert);
    expect(JSON.stringify(adminPush.mock.calls[0])).toContain("fee earned $6.00");
    expect(String(adminEmail.mock.calls[0]?.[1])).toContain("Fee earned (Frenz)");
    expect(String(adminEmail.mock.calls[0]?.[1])).toContain("$6.00");
  });
  it("once per event: a replay alerts nobody", async () => {
    await notify.notifyCoinAdmins("coin-transfer:x", A, alert);
    expect(await notify.notifyCoinAdmins("coin-transfer:x", A, alert)).toBe(false);
    expect(adminPush).toHaveBeenCalledTimes(2);
  });
  it("teeth: with the claim removed the second call WOULD alert again", async () => {
    await notify.notifyCoinAdmins("coin-transfer:y", A, alert);
    db.tables.coin_notification_claims = [];
    await notify.notifyCoinAdmins("coin-transfer:y", A, alert);
    expect(adminPush).toHaveBeenCalledTimes(4);
  });
  it("a paid withdrawal alerts the admins with its fee (from the sweep)", async () => {
    await notify.sweepCoinNotifications();
    expect(JSON.stringify(adminPush.mock.calls[0])).toContain("fee earned $6.00");
    expect(memberEmail).toHaveBeenCalledTimes(1); // the member's own receipt
  });
});

describe("a transfer: both members get their own receipt, the admins get the profit", () => {
  it("sender + recipient emails, admin alert with the fee; each receipt names the other side by public name only", async () => {
    await server.announceCoinTransfer({ transferId: T, recipientId: B, senderId: A, amountCents: 5_000, feeCents: 600, totalCents: 5_600 });
    const to = memberEmail.mock.calls.map((c) => c[0]);
    expect(to.sort()).toEqual([A, B].sort());
    const toSender = JSON.stringify(memberEmail.mock.calls.find((c) => c[0] === A));
    expect(toSender).toContain("to Bo");
    expect(toSender).toContain("$6.00");
    expect(toSender).not.toContain("bo@example.com");
    const toRecipient = JSON.stringify(memberEmail.mock.calls.find((c) => c[0] === B));
    expect(toRecipient).toContain("Ada sent you $50.00");
    expect(toRecipient).not.toContain("$6.00"); // the sender's fee is the sender's business
    expect(JSON.stringify(adminPush.mock.calls[0])).toContain("fee earned $6.00");
    // a replayed announce sends nothing more
    memberEmail.mockClear();
    adminPush.mockClear();
    await server.announceCoinTransfer({ transferId: T, recipientId: B, senderId: A, amountCents: 5_000, feeCents: 600, totalCents: 5_600 });
    expect(memberEmail).not.toHaveBeenCalled();
    expect(adminPush).not.toHaveBeenCalled();
  });
});
