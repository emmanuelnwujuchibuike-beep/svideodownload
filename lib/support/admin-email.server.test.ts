import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Owner, 2026-10-26: "make admin can send support email to users even if they didn't start a support message … with
 * the support@frenzsave.com mail and the Frenz support template". The real lib/support/chat.ts over an in-memory DB.
 */
let db: FakeDb;
const emails: { to: string; opts: Record<string, unknown> }[] = [];
let accept = true;
const pushes: unknown[][] = [];
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/email/resend", () => ({ sendProductEmail: async (to: string, opts: Record<string, unknown>) => (emails.push({ to, opts }), accept) }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: async (...a: unknown[]) => void pushes.push(a) }));
vi.mock("@/lib/notify", () => ({ alertEmailHtml: () => "", sendAdminEmail: async () => true }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
const { startSupportEmail, searchSupportRecipients } = await import("./chat");

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const ADA = "bbbbbbbb-0000-4000-8000-000000000002";

beforeEach(() => {
  emails.length = 0;
  pushes.length = 0;
  accept = true;
  db = fakeDb({ profiles: [{ id: ADA, handle: "ada", display_name: "Ada Okafor", avatar_url: null, email: "ada@example.com" }], support_threads: [], support_messages: [] });
});

describe("an admin emails a member who never wrote to support", () => {
  it("from support@ in the Frenz template, and it opens their Support conversation (with a push)", async () => {
    const out = await startSupportEmail(ADMIN, { userId: ADA, subject: "About your payment", body: "We fixed it — try again." });
    expect(out).toMatchObject({ ok: true, to: "ada@example.com", threadId: expect.any(String) });
    expect(emails[0]).toMatchObject({ to: "ada@example.com", opts: { sender: "support", subject: "About your payment", heading: "About your payment", ctaHref: expect.stringContaining("/support") } });
    expect(db.tables.support_messages).toEqual([expect.objectContaining({ sender_role: "admin", sender_id: ADMIN, body: "About your payment\n\nWe fixed it — try again." })]);
    expect(db.tables.support_threads![0]).toMatchObject({ user_id: ADA, last_sender: "admin", user_unread: 1 });
    expect(pushes[0]![0]).toBe(ADA);
  });

  it("typing the member's email finds the member (case-insensitive) — same conversation", async () => {
    const out = await startSupportEmail(ADMIN, { email: "ADA@example.com", subject: "Hi", body: "Hello" });
    expect(out).toMatchObject({ ok: true, threadId: expect.any(String) });
    expect(db.tables.support_messages).toHaveLength(1);
  });

  it("an address that is no member: email only — no conversation, no push", async () => {
    const out = await startSupportEmail(ADMIN, { email: "someone@else.org", subject: "Hello", body: "Message" });
    expect(out).toEqual({ ok: true, delivered: "email", threadId: null, to: "someone@else.org" });
    expect(emails[0]!.opts).toMatchObject({ sender: "support" });
    expect(emails[0]!.opts.ctaHref).toBeUndefined();
    expect(db.tables.support_messages).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("🔴 the email refused: the admin is told, and nothing is recorded as sent", async () => {
    accept = false;
    expect(await startSupportEmail(ADMIN, { userId: ADA, subject: "x", body: "y" })).toEqual({ ok: false, error: "The email couldn't be sent. Try again." });
    expect(db.tables.support_messages).toEqual([]);
  });

  it("🔴 what the admin typed is escaped in the email (it is HTML)", async () => {
    await startSupportEmail(ADMIN, { userId: ADA, subject: "<b>x</b>", body: "<script>alert(1)</script>" });
    expect(emails[0]!.opts.heading).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(emails[0]!.opts.body).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("no subject, no message, or not an email address: refused before anything is sent", async () => {
    expect(await startSupportEmail(ADMIN, { userId: ADA, subject: " ", body: "y" })).toMatchObject({ ok: false });
    expect(await startSupportEmail(ADMIN, { userId: ADA, subject: "x", body: "  " })).toMatchObject({ ok: false });
    expect(await startSupportEmail(ADMIN, { email: "not-an-email", subject: "x", body: "y" })).toMatchObject({ ok: false, error: "Enter a valid email address." });
    expect(emails).toEqual([]);
  });
});

describe("the member picker", () => {
  it("under two characters asks nothing (the in-memory database cannot run the or(ilike) search itself)", async () => {
    expect(await searchSupportRecipients("a")).toEqual([]);
    expect(await searchSupportRecipients("@a")).toEqual([]);
  });
  it("🔴 PostgREST syntax and wildcards typed into the search are stripped", async () => {
    expect(await searchSupportRecipients("%,(")).toEqual([]);
  });
});
