import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * New-message email (0262, owner 2026-10-18): email and push, and email can be turned off in chat only
 * by someone who has push on a device. Through the real settings route and the real sender, on an
 * in-memory database; the email provider is a recorder, so nothing is sent.
 */

let db: FakeDb;
let sessionUser: { id: string } | null = null;
const sent: { userId: string; subject: string; intro: string; kind: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/email/member-email", () => ({
  emailMember: async (userId: string, opts: { subject: string; intro: string }, kind: string) => {
    sent.push({ userId, subject: opts.subject, intro: opts.intro, kind });
    return "sent";
  },
}));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1); // sender
const B = U(2); // recipient
const C = U(3); // group member
const DIRECT = `20000000-0000-4000-8000-${"0".repeat(11)}1`;
const GROUP = `20000000-0000-4000-8000-${"0".repeat(11)}2`;
const SECRET = `20000000-0000-4000-8000-${"0".repeat(11)}3`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;

beforeEach(() => {
  sessionUser = null;
  sent.length = 0;
  db = fakeDb({
    notification_settings: [],
    push_subscriptions: [],
    message_email_sends: [],
    messages: [],
    conversation_members: [
      { conversation_id: GROUP, user_id: B, last_read_at: null },
      { conversation_id: GROUP, user_id: C, last_read_at: null },
    ],
  });
});

const send = async (over: Partial<Parameters<typeof import("./message-email").emailNewMessage>[0]> = {}) => {
  const { emailNewMessage } = await import("./message-email");
  await emailNewMessage({ senderName: "Ada", senderHandle: "ada", senderAvatarUrl: null, conversationId: DIRECT, conversationType: "direct", recipientIds: [B], mentionedIds: new Set(), preview: "hey there", ...over });
};

describe("the timing rule", () => {
  it("never while they're in the chat, once per unread batch, at most hourly", async () => {
    const { shouldEmail } = await import("./message-email");
    const now = Date.now();
    expect(shouldEmail({ now, lastReadAt: 0, lastEmailAt: 0 })).toBe(true);
    expect(shouldEmail({ now, lastReadAt: now - 5 * MIN, lastEmailAt: 0 })).toBe(false); // reading right now
    expect(shouldEmail({ now, lastReadAt: now - 3 * 60 * MIN, lastEmailAt: now - 2 * 60 * MIN })).toBe(false); // already emailed this batch
    expect(shouldEmail({ now, lastReadAt: now - 90 * MIN, lastEmailAt: now - 30 * MIN })).toBe(false); // already emailed this batch
    expect(shouldEmail({ now, lastReadAt: now - 20 * MIN, lastEmailAt: now - 3 * 60 * MIN })).toBe(true); // read since, a new batch
  });
});

describe("sending", () => {
  it("a direct message emails the recipient once — the next one in the same unread batch doesn't", async () => {
    await send();
    expect(sent).toEqual([{ userId: B, subject: "New message from Ada", intro: "hey there", kind: "new_message" }]);
    await send({ preview: "second" });
    expect(sent).toHaveLength(1);
    expect(db.tables.message_email_sends).toHaveLength(1);
  });

  it("not while they are reading the chat", async () => {
    db.tables.messages!.push({ id: "m1", conversation_id: DIRECT, sender_id: A, read_at: ago(2 * MIN) });
    await send();
    expect(sent).toHaveLength(0);
  });

  it("a group emails only the people it @mentions", async () => {
    await send({ conversationId: GROUP, conversationType: "group", recipientIds: [B, C], mentionedIds: new Set([C]) });
    expect(sent.map((s) => s.userId)).toEqual([C]);
    expect(sent[0]!.subject).toBe("Ada mentioned you");
  });

  it("a secret chat never puts its text in the email", async () => {
    await send({ conversationId: SECRET, conversationType: "secret", preview: "New encrypted message" });
    expect(sent[0]!.intro).toBe("Open Frenz to read it.");
  });

  it("someone who turned message email off gets none", async () => {
    db.tables.notification_settings!.push({ user_id: B, message_email: false });
    await send();
    expect(sent).toHaveLength(0);
  });
});

describe("the switch in chat", () => {
  const patch = async (body: unknown) => {
    const r = (await import("@/app/api/notification-settings/route")) as unknown as { PATCH: (r: Request) => Promise<Response> };
    return r.PATCH(new Request("https://frenzsave.com/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  };

  it("without push on any device it can't be turned off — and nothing is written", async () => {
    sessionUser = { id: B };
    const res = await patch({ messageEmail: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "push_required" });
    expect(db.tables.notification_settings).toHaveLength(0);
  });

  it("with the app's push on, it turns off — and stays off for the next message", async () => {
    sessionUser = { id: B };
    db.tables.push_subscriptions!.push({ id: "s1", user_id: B, endpoint: "https://push.example/1" });
    expect((await patch({ messageEmail: false })).status).toBe(200);
    expect(db.tables.notification_settings![0]).toMatchObject({ user_id: B, message_email: false });
    await send();
    expect(sent).toHaveLength(0);
  });

  it("turning it back on never needs push", async () => {
    sessionUser = { id: B };
    expect((await patch({ messageEmail: true })).status).toBe(200);
  });
});
