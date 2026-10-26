import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin closeout — lib/coin/notify.ts over an in-memory database (the claim table's primary key is modelled).
 * Pinned: every notification is claimed once by key — a second sweep, a retried webhook or a replayed request sends
 * nothing; withdrawal pushes reuse the in-app row the database wrote with the change ("already-recorded"); a PIN
 * change emails the CONFIRMED address only and never carries a PIN or code; a failed send never throws.
 */
let db: FakeDb;
const push = vi.fn(async (..._a: unknown[]) => {});
const emails: { to: string; text: string }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: (...a: unknown[]) => push(...a) }));
vi.mock("@/lib/email/resend", () => ({ hasResend: true, sendProductEmail: vi.fn(async (to: string, o: Record<string, string>) => (emails.push({ to, text: JSON.stringify(o) }), true)) }));
const notify = await import("./notify");
const U = "11111111-1111-4111-8111-111111111111";
const recent = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  db = fakeDb({
    coin_notification_claims: [],
    coin_deposits: [
      { reference: "frenz_coin_dep_fw_a", user_id: U, amount_cents: 5_000, status: "held", settled_at: recent, release_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), released_at: null },
      { reference: "frenz_coin_dep_fw_b", user_id: U, amount_cents: 2_000, status: "released", settled_at: recent, release_at: recent, released_at: recent },
    ],
    withdrawal_requests: [
      { id: "w1", user_id: U, source: "coin", status: "completed", net_cents: 9_400, updated_at: recent },
      { id: "w2", user_id: U, source: "credits", status: "completed", net_cents: 100, updated_at: recent },
    ],
  });
  db.unique.coin_notification_claims = [["key"]];
  push.mockReset();
  emails.length = 0;
});

describe("coin notifications", () => {
  it("a claim is once: the second caller sends nothing", async () => {
    expect(await notify.claimCoinNotification("k1", U)).toBe(true);
    expect(await notify.claimCoinNotification("k1", U)).toBe(false);
  });
  it("the sweep sends each deposit / withdrawal notice once — a second run sends nothing", async () => {
    const first = await notify.sweepCoinNotifications();
    expect(first.sent).toBe(4); // held (a), held (b), released (b), withdrawal paid (w1)
    const second = await notify.sweepCoinNotifications();
    expect(second.sent).toBe(0);
    expect(push).toHaveBeenCalledTimes(4);
    // the AI-credit withdrawal is not a coin notification
    expect(push.mock.calls.some((c) => JSON.stringify(c).includes("w2"))).toBe(false);
    const wd = push.mock.calls.find((c) => (c[1] as { tag: string }).tag === "coin-wd:w1:completed")!;
    expect(wd[4]).toBe("already-recorded");
    expect((wd[1] as { body: string }).body).toContain("$94.00");
    const held = push.mock.calls.find((c) => (c[1] as { tag: string }).tag === "coin-deposit-held:frenz_coin_dep_fw_a")!;
    expect(held[4]).toEqual({ type: "coin_deposit_update" });
    expect((held[1] as { body: string }).body).toMatch(/\$50\.00 .* on hold until/);
  });
  it("a failed push never throws, and is not retried (the claim stands)", async () => {
    push.mockRejectedValueOnce(new Error("push down"));
    await expect(notify.notifyCoin(U, "k2", "coin_transfer_sent", { title: "t", body: "b", genericBody: "g" })).resolves.toBe(false);
    await expect(notify.notifyCoin(U, "k2", "coin_transfer_sent", { title: "t", body: "b", genericBody: "g" })).resolves.toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it("a PIN change: in-app (security) and an email to the CONFIRMED address — no PIN, no code; once per change", async () => {
    await notify.announceCoinPinChange({ id: U, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" }, "reset", "evt-1");
    await notify.announceCoinPinChange({ id: U, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" }, "reset", "evt-1");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![3]).toBe("security");
    expect(push.mock.calls[0]![4]).toEqual({ type: "coin_pin_security" });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toBe("me@t.test");
    expect(emails[0]!.text).not.toMatch(/\d{6}/);
  });
  it("an unconfirmed address is not emailed", async () => {
    await notify.announceCoinPinChange({ id: U, email: "me@t.test", email_confirmed_at: null }, "change", "evt-2");
    expect(emails).toEqual([]);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
