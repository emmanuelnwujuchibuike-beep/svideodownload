import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 11 — the unsubscribe endpoint and the settings switch, end to end on an in-memory database.
 * Nothing is sent: no email path is reached from here.
 */

let db: FakeDb;
let limited = false;
let sessionUser: { id: string } | null = null;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/rate-limit", () => ({ clientId: () => "1.2.3.4", trackLimiter: { limit: async () => ({ success: !limited }) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/social/notification-settings", () => ({
  DEFAULT_NOTIFICATION_SETTINGS: {},
  getNotificationSettings: async () => ({ categoryPrefs: {} }),
  setNotificationSettings: async () => ({ ok: true }),
}));
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac-derivation";

const consent = await import("@/lib/email/consent");
const route = await import("./route");
const settings = await import("@/app/api/notification-settings/route");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1);
const B = U(2);
const BASE = "https://frenzsave.com/api/email/unsubscribe";

beforeEach(() => {
  db = fakeDb({ notification_settings: [], email_unsubscribe_tokens: [] });
  db.unique.notification_settings = [["user_id"]];
  db.unique.email_unsubscribe_tokens = [["user_id"], ["token_hash"]];
  limited = false;
  sessionUser = null;
});

const tokenFor = async (id: string) => new URL((await consent.unsubscribeUrlFor(id))!).searchParams.get("t")!;
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (url: string, body: string) => route.POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));

describe("GET never changes anything (link scanners and previews open links)", () => {
  it("a valid link only redirects to the confirmation page; the member is still subscribed", async () => {
    const t = await tokenFor(A);
    for (let i = 0; i < 3; i++) {
      const res = await route.GET(new Request(`${BASE}?t=${t}`));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toMatch(new RegExp(`/unsubscribe\\?t=${t}$`));
    }
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
    expect(db.tables.notification_settings).toHaveLength(0);
  });

  it("a malformed link goes to the plain 'not valid' page and the token is not echoed", async () => {
    const res = await route.GET(new Request(`${BASE}?t=<script>`));
    expect(res.headers.get("location")).toMatch(/\/unsubscribe\?state=invalid$/);
  });
});

describe("POST", () => {
  it("RFC 8058 one-click from a mail client: 200, opted out, and idempotent", async () => {
    const t = await tokenFor(A);
    const first = await post(`${BASE}?t=${t}`, form({ "List-Unsubscribe": "One-Click" }));
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("Unsubscribed.");
    expect(await consent.optionalEmailAllowed(A)).toBe(false);
    expect((await post(`${BASE}?t=${t}`, form({ "List-Unsubscribe": "One-Click" }))).status).toBe(200);
  });

  it("the page's button: redirect to 'done', no token in the redirect", async () => {
    const t = await tokenFor(A);
    const res = await post(BASE, form({ t }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/unsubscribe\?state=done$/);
    expect(res.headers.get("location")).not.toContain(t);
    expect(await consent.optionalEmailAllowed(A)).toBe(false);
  });

  it("an unknown or malformed token: 'invalid', nothing changed, nothing about any account revealed", async () => {
    await tokenFor(A);
    const unknown = consent.unsubscribeTokenFor(B)!;
    for (const t of [unknown, "nope"]) {
      const res = await post(BASE, form({ t }));
      expect(res.headers.get("location")).toMatch(/\/unsubscribe\?state=invalid$/);
    }
    const one = await post(`${BASE}?t=${unknown}`, form({ "List-Unsubscribe": "One-Click" }));
    expect(one.status).toBe(400);
    expect(await one.text()).toBe("This link isn't valid.");
    expect(db.tables.notification_settings).toHaveLength(0);
  });

  it("rate-limited before any token is looked at", async () => {
    limited = true;
    const t = await tokenFor(A);
    expect((await post(BASE, form({ t }))).status).toBe(429);
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
  });
});

describe("the settings switch is the SESSION member's own", () => {
  const patch = (body: unknown) => settings.PATCH(new Request("https://frenzsave.com/api/notification-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("signed out: 401 and nothing written", async () => {
    expect((await patch({ optionalEmail: false })).status).toBe(401);
    expect(db.tables.notification_settings).toHaveLength(0);
  });

  it("signed in: writes the session user's row only — an id in the body is not accepted", async () => {
    sessionUser = { id: A };
    expect((await patch({ optionalEmail: false })).status).toBe(200);
    expect(await consent.optionalEmailAllowed(A)).toBe(false);
    // a smuggled id is dropped by the schema: the write still lands on the SESSION member (A), never on B
    db.tables.notification_settings!.push({ user_id: B, optional_email: false });
    expect((await patch({ optionalEmail: true, userId: B })).status).toBe(200);
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
    expect(await consent.optionalEmailAllowed(B)).toBe(false);
  });

  it("GET reports the switch beside the settings", async () => {
    sessionUser = { id: A };
    await patch({ optionalEmail: false });
    const res = await settings.GET();
    expect(await res.json()).toMatchObject({ optionalEmail: { on: false, ready: true } });
  });
});
