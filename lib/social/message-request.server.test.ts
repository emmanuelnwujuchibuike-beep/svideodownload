import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * 0295: message requests by push and email. Pins: what counts as a request (one-to-one chat, recipient neither
 * follows nor is friends with the sender, never replied — a read error counts as a request); once per chat; each
 * switch on its own; and the message itself NEVER appears in the push or the email.
 */
let db: FakeDb;
const pushes: { userId: string; payload: Record<string, unknown>; opts: { push?: boolean } }[] = [];
const emails: { userId: string; opts: Record<string, unknown>; kind: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({
  sendSmartPush: async (userId: string, payload: Record<string, unknown>, _p: string, _c: string, _r: unknown, opts: { push?: boolean } = {}) => {
    pushes.push({ userId, payload, opts });
    return { decision: opts.push === false ? "in_app" : "push", reasons: [], devices: 1, accepted: 1 };
  },
}));
vi.mock("@/lib/email/member-email", () => ({
  emailMember: async (userId: string, opts: Record<string, unknown>, kind: string) => {
    emails.push({ userId, opts, kind });
    return "sent";
  },
}));

const mr = await import("@/lib/social/message-request");

const R = "00000000-0000-4000-8000-00000000000a"; // recipient
const S = "00000000-0000-4000-8000-00000000000b"; // sender (a stranger)
const CONV = "00000000-0000-4000-8000-0000000000c1";
const SECRET_TEXT = "my bank pin is 1234";
const sender = { name: "Sam", handle: "sam", avatarUrl: null };
const input = { recipientId: R, senderId: S, conversationId: CONV, conversationType: "direct" };

beforeEach(() => {
  pushes.length = 0;
  emails.length = 0;
  db = fakeDb({ follows: [], friendships: [], messages: [{ id: "m1", conversation_id: CONV, sender_id: S, body: SECRET_TEXT }], notification_settings: [], message_request_notices: [] });
  db.unique.message_request_notices = [["user_id", "conversation_id"]];
  db.unique.notification_settings = [["user_id"]];
});

describe("isMessageRequest", () => {
  it("a stranger in a direct chat is a request; so is a secret chat", async () => {
    expect(await mr.isMessageRequest(db.client() as never, input)).toBe(true);
    expect(await mr.isMessageRequest(db.client() as never, { ...input, conversationType: "secret" })).toBe(true);
  });
  it("not when the recipient follows the sender (a sender following the recipient is not enough)", async () => {
    db.tables.follows = [{ follower_id: S, following_id: R }];
    expect(await mr.isMessageRequest(db.client() as never, input)).toBe(true);
    db.tables.follows = [{ follower_id: R, following_id: S }];
    expect(await mr.isMessageRequest(db.client() as never, input)).toBe(false);
  });
  it("not when they are friends (either order of ids)", async () => {
    const [low, high] = R < S ? [R, S] : [S, R];
    db.tables.friendships = [{ user_low: low, user_high: high }];
    expect(await mr.isMessageRequest(db.client() as never, input)).toBe(false);
  });
  it("not once the recipient has replied", async () => {
    db.tables.messages!.push({ id: "m2", conversation_id: CONV, sender_id: R, body: "hi" });
    expect(await mr.isMessageRequest(db.client() as never, input)).toBe(false);
  });
  it("never in a group", async () => {
    expect(await mr.isMessageRequest(db.client() as never, { ...input, conversationType: "group" })).toBe(false);
  });
  it("a read error counts as a request — it can only hide content", async () => {
    const broken = { from: (t: string) => (t === "follows" ? { select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) } : (db.client() as { from: (t: string) => unknown }).from(t)) };
    expect(await mr.isMessageRequest(broken as never, input)).toBe(true);
  });
});

describe("notifyMessageRequest", () => {
  it("push and email by default — the sender's name, never the message", async () => {
    const out = await mr.notifyMessageRequest(db.client() as never, { ...input, sender });
    expect(out).toEqual({ claimed: true, push: "push", email: "sent" });
    expect(pushes[0]!.payload).toMatchObject({ title: "New message request", body: "Sam wants to send you a message", url: `/messages/${CONV}`, tag: `msgreq:${CONV}` });
    expect(emails[0]).toMatchObject({ userId: R, kind: "message_request", opts: { subject: "New message request on Frenzsave", ctaPath: `/messages/${CONV}`, settingsPath: "/account/notifications" } });
    expect(JSON.stringify({ pushes, emails })).not.toContain(SECRET_TEXT);
  });
  it("once per chat: a second message from the same stranger notifies nothing", async () => {
    await mr.notifyMessageRequest(db.client() as never, { ...input, sender });
    const again = await mr.notifyMessageRequest(db.client() as never, { ...input, sender });
    expect(again).toEqual({ claimed: false });
    expect(pushes).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
  it("push off: recorded in-app only, email still goes", async () => {
    db.tables.notification_settings = [{ user_id: R, message_request_push: false, message_request_email: true }];
    const out = await mr.notifyMessageRequest(db.client() as never, { ...input, sender });
    expect(out).toMatchObject({ push: "preference_off", email: "sent" });
    expect(pushes[0]!.opts.push).toBe(false);
  });
  it("email off: no email, push still goes", async () => {
    db.tables.notification_settings = [{ user_id: R, message_request_push: true, message_request_email: false }];
    const out = await mr.notifyMessageRequest(db.client() as never, { ...input, sender });
    expect(out).toMatchObject({ push: "push", email: "preference_off" });
    expect(emails).toHaveLength(0);
  });
  it("a secret chat links to the secret thread", async () => {
    await mr.notifyMessageRequest(db.client() as never, { ...input, conversationType: "secret", sender });
    expect(pushes[0]!.payload.url).toBe(`/messages/secret/${CONV}`);
  });
});

describe("the two switches", () => {
  it("on by default; each written on its own", async () => {
    expect(await mr.getMessageRequestPrefs(R)).toEqual({ push: true, email: true, ready: true });
    expect(await mr.setMessageRequestPrefs(R, { push: false })).toEqual({ ok: true });
    expect(db.tables.notification_settings!.find((r) => r.user_id === R)).not.toHaveProperty("message_request_email");
    expect(await mr.getMessageRequestPrefs(R)).toMatchObject({ push: false, email: true });
    expect(await mr.setMessageRequestPrefs(R, {})).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the message route takes request recipients out of the ordinary notifications", () => {
  it("wired: decided per recipient, notified as a request, removed from the preview push and email", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/messages/route.ts", "utf8");
    expect(src).toContain("isMessageRequest(db, { recipientId, senderId, conversationId");
    expect(src).toContain("const recipientIds = memberIds.filter((id) => !requestIds.has(id));");
    // the preview push and the message email are built from recipientIds — after the filter
    expect(src.indexOf("const recipientIds = memberIds.filter")).toBeLessThan(src.indexOf("recipientIds.map((recipientId) =>"));
    expect(src.indexOf("const recipientIds = memberIds.filter")).toBeLessThan(src.indexOf("await emailNewMessage({"));
  });
});
