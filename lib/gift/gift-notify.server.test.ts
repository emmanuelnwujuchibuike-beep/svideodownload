import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 4.1: "you received a sticker gift" by push and email. The outbox functions (claim / finish) are
 * scripted here with the same rules 0294 enforces (pinned for real in supabase/tests/0294_gift_notifications.pglite.mjs);
 * the providers are mocks — no real push or email is sent. What these pin: each switch alone decides its own channel,
 * the global controls still decide on top, the right person and chat are used, nothing is sent twice, a reversed gift
 * is never announced, a provider failure is recorded (and retried) without touching anything else, and the email is
 * escaped and carries the settings link.
 */
let db: FakeDb;
const pushes: { userId: string; payload: Record<string, unknown>; category: string; record: unknown }[] = [];
let pushOutcome = { decision: "push", reasons: [] as string[], devices: 1, accepted: 1 };
const emails: { userId: string; opts: Record<string, unknown>; kind: string }[] = [];
let emailOutcome: "sent" | "skipped" | "failed" = "sent";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({
  sendSmartPush: async (userId: string, payload: Record<string, unknown>, _p: string, category: string, record: unknown) => {
    pushes.push({ userId, payload, category, record });
    return pushOutcome;
  },
}));
vi.mock("@/lib/email/member-email", () => ({
  emailMember: async (userId: string, opts: Record<string, unknown>, kind: string) => {
    emails.push({ userId, opts, kind });
    return emailOutcome;
  },
}));

const notify = await import("./gift-notify");

const SENDER = "00000000-0000-4000-8000-000000000001";
const RECIPIENT = "00000000-0000-4000-8000-000000000002";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const GIFT = "00000000-0000-4000-8000-0000000000f1";
type Row = { gift_id: string; channel: string; status: string; attempts: number; reason: string | null; claimed_at: number };
let outbox: Row[];
let giftStatus: "pending" | "released" | "reversed";

/** The 0294 claim / finish rules, in memory. */
function scriptOutbox() {
  db.rpc.claim_gift_notification = (a) => {
    const r = outbox.find((x) => x.gift_id === a.p_gift && x.channel === a.p_channel);
    if (!r) return { data: { ok: false, reason: "not_found" }, error: null };
    const due = r.status === "pending" || (r.status === "failed" && r.attempts < 3) || (r.status === "sending" && Date.now() - r.claimed_at > 15 * 60_000);
    if (!due) return { data: { ok: false, reason: "not_due" }, error: null };
    r.status = "sending";
    r.attempts++;
    r.claimed_at = Date.now();
    if (giftStatus === "reversed") {
      r.status = "skipped";
      r.reason = "reversed";
      return { data: { ok: false, reason: "reversed" }, error: null };
    }
    return { data: { ok: true, gift_id: GIFT, recipient_id: RECIPIENT, sender_id: SENDER, conversation_id: CONV, sticker_name: "Red <Rose>" }, error: null };
  };
  db.rpc.finish_gift_notification = (a) => {
    const r = outbox.find((x) => x.gift_id === a.p_gift && x.channel === a.p_channel && x.status === "sending");
    if (!r) return { data: false, error: null };
    r.status = String(a.p_status);
    r.reason = (a.p_reason as string | null) ?? null;
    return { data: true, error: null };
  };
  db.rpc.due_gift_notifications = () => ({ data: outbox.filter((r) => r.status === "pending" || (r.status === "failed" && r.attempts < 3)).map((r) => ({ gift_id: r.gift_id, channel: r.channel })), error: null });
}

const status = (ch: string) => outbox.find((r) => r.channel === ch)!;

beforeEach(() => {
  db = fakeDb({
    profiles: [{ id: SENDER, display_name: "Eve <script>alert(1)</script>", handle: "eve", avatar_url: "https://cdn.example.test/eve.webp" }, { id: RECIPIENT, display_name: "Bo", handle: "bo" }],
    notification_settings: [],
  });
  outbox = ["push", "email"].map((channel) => ({ gift_id: GIFT, channel, status: "pending", attempts: 0, reason: null, claimed_at: 0 }));
  giftStatus = "pending";
  pushes.length = 0;
  emails.length = 0;
  pushOutcome = { decision: "push", reasons: [], devices: 1, accepted: 1 };
  emailOutcome = "sent";
  scriptOutbox();
});
const prefs = (gift_push: boolean, gift_email: boolean) => db.tables.notification_settings!.push({ user_id: RECIPIENT, gift_push, gift_email });

describe("a received gift, by push and email", () => {
  it("both switches on: one push and one email, to the RECIPIENT, opening the chat", async () => {
    const r = await notify.dispatchGiftNotifications(GIFT);
    expect(r).toEqual({ push: "sent", email: "sent" });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ userId: RECIPIENT, category: "premium", record: "already-recorded" });
    expect(pushes[0]!.payload).toMatchObject({ title: "Sticker gift received", genericBody: "You received a sticker gift.", tag: `gift:${GIFT}` });
    expect(String(pushes[0]!.payload.url)).toMatch(new RegExp(`/messages/${CONV}$`));
    expect(String(pushes[0]!.payload.body)).toContain("You received a sticker gift from");
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ userId: RECIPIENT, kind: "gift_received", opts: { subject: "You received a sticker gift on Frenzsave", ctaPath: `/messages/${CONV}`, settingsPath: "/account/notifications" } });
    expect(status("push").status).toBe("sent");
    expect(status("email").status).toBe("sent");
  });
  it("push off, email on: email only", async () => {
    prefs(false, true);
    expect(await notify.dispatchGiftNotifications(GIFT)).toEqual({ push: "skipped", email: "sent" });
    expect(pushes).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(status("push")).toMatchObject({ status: "skipped", reason: "preference_off" });
  });
  it("email off, push on: push only", async () => {
    prefs(true, false);
    expect(await notify.dispatchGiftNotifications(GIFT)).toEqual({ push: "sent", email: "skipped" });
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(0);
    expect(status("email")).toMatchObject({ status: "skipped", reason: "preference_off" });
  });
  it("both off: neither", async () => {
    prefs(false, false);
    expect(await notify.dispatchGiftNotifications(GIFT)).toEqual({ push: "skipped", email: "skipped" });
    expect(pushes).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });
  it("the global controls still decide: a push held by quiet hours / the master switch is skipped, not sent", async () => {
    pushOutcome = { decision: "in_app", reasons: ["quiet_hours"], devices: 0, accepted: 0 };
    expect((await notify.dispatchGiftNotifications(GIFT)).push).toBe("skipped");
    expect(status("push")).toMatchObject({ status: "skipped", reason: "quiet_hours" });
  });
  it("no device to push to: skipped (no_devices), never 'sent'", async () => {
    pushOutcome = { decision: "push", reasons: [], devices: 0, accepted: 0 };
    expect((await notify.dispatchGiftNotifications(GIFT)).push).toBe("skipped");
    expect(status("push")).toMatchObject({ status: "skipped", reason: "no_devices" });
  });
  it("the optional-email switch / no address: the email is skipped (not_eligible)", async () => {
    emailOutcome = "skipped";
    expect((await notify.dispatchGiftNotifications(GIFT)).email).toBe("skipped");
    expect(status("email")).toMatchObject({ status: "skipped", reason: "not_eligible" });
  });
});

describe("once, and never for the wrong gift", () => {
  it("a replayed gift request dispatches again and sends nothing more", async () => {
    await notify.dispatchGiftNotifications(GIFT);
    const again = await notify.dispatchGiftNotifications(GIFT);
    expect(again).toEqual({ push: "not_due", email: "not_due" });
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
  it("two dispatches at the same moment send each channel once", async () => {
    await Promise.all([notify.dispatchGiftNotifications(GIFT), notify.dispatchGiftNotifications(GIFT)]);
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
  it("a gift reversed before it was announced is never announced as received", async () => {
    giftStatus = "reversed";
    expect(await notify.dispatchGiftNotifications(GIFT)).toEqual({ push: "skipped", email: "skipped" });
    expect(pushes).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });
});

describe("failures are recorded and retried, and change nothing else", () => {
  it("a push no device accepted is failed (retryable); the email still goes", async () => {
    pushOutcome = { decision: "push", reasons: [], devices: 2, accepted: 0 };
    expect(await notify.dispatchGiftNotifications(GIFT)).toEqual({ push: "failed", email: "sent" });
    expect(status("push")).toMatchObject({ status: "failed", reason: "push_refused" });
  });
  it("a refused email is failed; the sweep retries it once it works, and a sent push is not resent", async () => {
    emailOutcome = "failed";
    await notify.dispatchGiftNotifications(GIFT);
    expect(status("email")).toMatchObject({ status: "failed", attempts: 1 });
    emailOutcome = "sent";
    const swept = await notify.sweepGiftNotifications(10);
    expect(swept).toMatchObject({ sent: 1 });
    expect(status("email").status).toBe("sent");
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(2);
  });
  it("a provider that throws is recorded failed — dispatch never throws", async () => {
    db.rpc.claim_gift_notification = () => {
      throw new Error("network down");
    };
    await expect(notify.dispatchGiftNotifications(GIFT)).resolves.toBeTruthy();
  });
  it("after three failed tries the sweep stops (visible as failed)", async () => {
    emailOutcome = "failed";
    await notify.dispatchGiftNotifications(GIFT);
    await notify.sweepGiftNotifications(10);
    await notify.sweepGiftNotifications(10);
    await notify.sweepGiftNotifications(10);
    expect(status("email")).toMatchObject({ status: "failed", attempts: 3 });
  });
});

describe("content", () => {
  it("names the sender by public name only, with no balance, PIN, price or chat content", async () => {
    await notify.dispatchGiftNotifications(GIFT);
    const all = JSON.stringify([pushes, emails]);
    expect(all).not.toMatch(/balance|pin\b|FGC|price|4500|5000/i);
    expect(emails[0]!.opts.person).toMatchObject({ name: "Eve <script>alert(1)</script>", handle: "eve" });
  });
});

// ── the email itself: escaped, with the settings link (the real member-email + template, the provider mocked) ──
describe("the gift email is escaped and links to the settings", () => {
  it("emailMember escapes the sender's name and sticker and adds the 'Manage notification settings' link", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/email/member-email");
    const sent: { to: string; opts: Record<string, unknown> }[] = [];
    vi.doMock("@/lib/email/resend", () => ({ hasResend: true, sendProductEmail: async (to: string, opts: Record<string, unknown>) => (sent.push({ to, opts }), true) }));
    vi.doMock("@/lib/email/consent", async (orig) => ({ ...(await orig<typeof import("@/lib/email/consent")>()), optionalEmailAllowed: async () => true, unsubscribeUrlFor: async () => null }));
    db.tables.profiles!.find((p) => p.id === RECIPIENT)!.email = "bo@t.test";
    const { emailMember } = await import("@/lib/email/member-email");
    const out = await emailMember(RECIPIENT, { subject: "s", heading: "You received a sticker gift", intro: "Eve <script>alert(1)</script> sent you a sticker gift: Red <Rose>.", ctaLabel: "Open the chat", ctaPath: `/messages/${CONV}`, person: { name: "Eve <b>", handle: "eve", avatarUrl: null }, settingsPath: "/account/notifications" }, "gift_received");
    expect(out).toBe("sent");
    expect(sent[0]!.to).toBe("bo@t.test");
    expect(String(sent[0]!.opts.intro)).toBe("Eve &lt;script&gt;alert(1)&lt;/script&gt; sent you a sticker gift: Red &lt;Rose&gt;.");
    expect((sent[0]!.opts.person as { name: string }).name).toBe("Eve &lt;b&gt;");
    expect(String(sent[0]!.opts.settingsHref)).toMatch(/\/account\/notifications$/);
    vi.doUnmock("@/lib/email/resend");
    vi.doUnmock("@/lib/email/consent");
  });
});
