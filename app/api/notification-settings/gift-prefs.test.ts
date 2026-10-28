import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 4.1 (0294): the two gift switches through /api/notification-settings — each saved on its own
 * (sending one never writes the other), only for the signed-in member's own row, the rest of the settings untouched.
 */
let db: FakeDb;
let sessionUser: { id: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));

const route = await import("@/app/api/notification-settings/route");
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const patch = (body: unknown) => new Request("https://frenzsave.com/api/notification-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const row = (u: string) => db.tables.notification_settings!.find((r) => r.user_id === u);

beforeEach(() => {
  db = fakeDb({ notification_settings: [{ user_id: B, gift_push: true, gift_email: true, master_enabled: true, push_enabled: true }], push_subscriptions: [] });
  db.unique.notification_settings = [["user_id"]];
  sessionUser = { id: A };
});

describe("the gift switches", () => {
  it("needs a session", async () => {
    sessionUser = null;
    expect((await route.PATCH(patch({ giftPush: false }))).status).toBe(401);
    expect(row(A)).toBeUndefined();
  });
  it("on by default when the member never chose", async () => {
    const res = await route.GET();
    expect(await res.json()).toMatchObject({ giftNotify: { push: true, email: true } });
  });
  it("turning push off writes push only — email stays on", async () => {
    expect((await route.PATCH(patch({ giftPush: false }))).status).toBe(200);
    expect(row(A)).toMatchObject({ gift_push: false });
    expect("gift_email" in row(A)!).toBe(false);
    expect(await (await route.GET()).json()).toMatchObject({ giftNotify: { push: false, email: true } });
  });
  it("turning email off writes email only — push stays as it was", async () => {
    await route.PATCH(patch({ giftPush: false }));
    expect((await route.PATCH(patch({ giftEmail: false }))).status).toBe(200);
    expect(row(A)).toMatchObject({ gift_push: false, gift_email: false });
    await route.PATCH(patch({ giftPush: true }));
    expect(row(A)).toMatchObject({ gift_push: true, gift_email: false });
  });
  it("only the session member's own row is ever written (no way to name another member)", async () => {
    expect((await route.PATCH(patch({ giftPush: false, userId: B }))).status).toBe(200);
    expect(row(B)).toMatchObject({ gift_push: true, gift_email: true });
    expect(row(A)).toMatchObject({ gift_push: false });
  });
  it("a non-boolean is refused", async () => {
    expect((await route.PATCH(patch({ giftPush: "off" }))).status).toBe(400);
  });
  it("a gift-only change leaves the other settings alone", async () => {
    db.tables.notification_settings!.push({ user_id: A, master_enabled: false, push_enabled: false, gift_push: true, gift_email: true });
    await route.PATCH(patch({ giftEmail: false }));
    expect(row(A)).toMatchObject({ master_enabled: false, push_enabled: false, gift_push: true, gift_email: false });
  });
});
