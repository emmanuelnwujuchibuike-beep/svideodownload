import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 6 (0296): several copies sent in one action are announced ONCE. The claim (scripted with the
 * 0294 rules plus 0296's batch fields) tells the dispatcher each gift's place: the first sends one push and one email
 * stating the count, every other copy's rows are closed "batched" — each row still claimed and finished exactly once.
 * The sweep reaching a later copy first closes it the same way. The sender's note never appears in either.
 * Providers are mocks: no real push or email is sent.
 */
let db: FakeDb;
const pushes: { userId: string; payload: Record<string, unknown> }[] = [];
const emails: { userId: string; opts: Record<string, unknown>; kind: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({
  sendSmartPush: async (userId: string, payload: Record<string, unknown>) => (pushes.push({ userId, payload }), { decision: "push", reasons: [], devices: 1, accepted: 1 }),
}));
vi.mock("@/lib/email/member-email", () => ({
  emailMember: async (userId: string, opts: Record<string, unknown>, kind: string) => (emails.push({ userId, opts, kind }), "sent"),
}));

const notify = await import("./gift-notify");

const SENDER = "00000000-0000-4000-8000-000000000001";
const RECIPIENT = "00000000-0000-4000-8000-000000000002";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const G = ["00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2", "00000000-0000-4000-8000-0000000000f3"];
const NOTE = "For always hyping my stories";
type Row = { gift_id: string; channel: string; status: string; attempts: number; reason: string | null };
let outbox: Row[];

beforeEach(() => {
  pushes.length = 0;
  emails.length = 0;
  db = fakeDb({ profiles: [{ id: SENDER, display_name: "Tolu", handle: "tolu" }], notification_settings: [] });
  outbox = G.flatMap((gift_id) => ["push", "email"].map((channel) => ({ gift_id, channel, status: "pending", attempts: 0, reason: null })));
  db.rpc.claim_gift_notification = (a) => {
    const r = outbox.find((x) => x.gift_id === a.p_gift && x.channel === a.p_channel);
    if (!r || !(r.status === "pending" || (r.status === "failed" && r.attempts < 3))) return { data: { ok: false, reason: "not_due" }, error: null };
    r.status = "sending";
    r.attempts++;
    // the 0296 claim: the gift's place in its batch. The note is NOT part of a claim (and is never read here).
    return { data: { ok: true, gift_id: a.p_gift, recipient_id: RECIPIENT, sender_id: SENDER, conversation_id: CONV, sticker_name: "Red Rose", batch_index: G.indexOf(String(a.p_gift)) + 1, batch_size: 3 }, error: null };
  };
  db.rpc.finish_gift_notification = (a) => {
    const r = outbox.find((x) => x.gift_id === a.p_gift && x.channel === a.p_channel && x.status === "sending");
    if (!r) return { data: false, error: null };
    r.status = String(a.p_status);
    r.reason = (a.p_reason as string | null) ?? null;
    return { data: true, error: null };
  };
  db.rpc.due_gift_notifications = () => ({ data: outbox.filter((r) => r.status === "pending").map((r) => ({ gift_id: r.gift_id, channel: r.channel })), error: null });
});

describe("a batch is announced once", () => {
  it("one push and one email, stating the count; the other copies closed as batched", async () => {
    await notify.dispatchGiftBatchNotifications(G);
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(pushes[0]!.payload).toMatchObject({ title: "Sticker gifts received", body: "You received 3 sticker gifts from Tolu: Red Rose" });
    expect(emails[0]!.opts.intro).toBe("Tolu sent you 3 sticker gifts: Red Rose.");
    expect(outbox.filter((r) => r.gift_id === G[0]).every((r) => r.status === "sent")).toBe(true);
    expect(outbox.filter((r) => r.gift_id !== G[0]).every((r) => r.status === "skipped" && r.reason === "batched")).toBe(true);
    // every row claimed exactly once
    expect(outbox.every((r) => r.attempts === 1)).toBe(true);
  });
  it("dispatching the batch again sends nothing more", async () => {
    await notify.dispatchGiftBatchNotifications(G);
    await notify.dispatchGiftBatchNotifications(G);
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
  it("the sweep reaching a later copy first closes it — it never sends that copy on its own", async () => {
    outbox.filter((r) => r.gift_id === G[0]).forEach((r) => (r.status = "sent"));
    await notify.sweepGiftNotifications();
    expect(pushes).toHaveLength(0);
    expect(emails).toHaveLength(0);
    expect(outbox.filter((r) => r.gift_id !== G[0]).every((r) => r.reason === "batched")).toBe(true);
  });
  it("the sender's note is in neither the push nor the email", async () => {
    await notify.dispatchGiftBatchNotifications(G);
    expect(JSON.stringify({ pushes, emails })).not.toContain(NOTE);
  });
  it("an empty batch dispatches nothing", async () => {
    expect(await notify.dispatchGiftBatchNotifications([])).toBeNull();
    expect(pushes).toHaveLength(0);
  });
});
