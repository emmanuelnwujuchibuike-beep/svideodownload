import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 4: the member routes (gallery, send) and the admin routes (gifting rules, pending gifts). The
 * database functions are scripted here — their own behaviour (money, locks, PIN, chat rules) is pinned in
 * supabase/tests/0293_gift_sends.pglite.mjs and gift_sends_concurrency.pg.mjs. What these pin: who may call, that the
 * PIN proof is required, that a client can't supply a share / commission / balance / hold, that the rules come from the
 * server, and that the gift message is posted with the gift's own client id (so a retry never duplicates it).
 */
let db: FakeDb;
let sessionUser: { id: string } | null = null;
let admin: { id: string } | null = null;
let reauthed = false;
let pinOk = true;
let coinEnabled = true;
const sendMessage = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, id: "msg-1" }));

const afterCalls: (() => unknown)[] = [];
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void afterCalls.push(fn) }));
const dispatched: string[] = [];
vi.mock("@/lib/gift/gift-notify", () => ({ dispatchGiftNotifications: async (id: string) => (dispatched.push(id), { push: "sent", email: "sent" }), dispatchGiftBatchNotifications: async (ids: string[]) => (dispatched.push(...ids), { push: "sent", email: "sent" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => reauthed }));
vi.mock("@/lib/rate-limit", () => ({ aiJobCreateLimiter: { limit: async () => ({ success: true }) }, pinLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/social/messages", () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a) }));
vi.mock("@/lib/landing/settings", async () => ({ getLandingSettings: async () => ({ frenzCoin: { ...(await import("@/lib/coin/config")).COIN_DEFAULTS, enabled: coinEnabled } }) }));
vi.mock("@/lib/coin/authorization", async (orig) => {
  const real = await orig<typeof import("@/lib/coin/authorization")>();
  return {
    ...real,
    authorizeGift: async (userId: string) => (pinOk ? { ok: true, authorization: { userId, attemptId: "att-1", keyHex: "\\x00", method: "transaction_pin", purpose: "gift" } } : { ok: false, reason: "authorization_failed" }),
    isCoinTransferAuthorized: (a: { userId?: string; purpose?: string } | null, userId: string, purpose = "transfer") => !!a && a.userId === userId && a.purpose === purpose,
  };
});

const gallery = await import("@/app/api/gift/gallery/route");
const send = await import("@/app/api/gift/send/route");
const gifting = await import("@/app/api/admin/gift/gifting/route");
const gifts = await import("@/app/api/admin/gift/gifts/route");

const SENDER = "00000000-0000-4000-8000-000000000001";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const STICKER = "00000000-0000-4000-8000-0000000000a1";
const GIFT = "00000000-0000-4000-8000-0000000000f1";
const RULES = { version: 2, recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 10_000_000 };
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const body = (over: Record<string, unknown> = {}) => ({ conversationId: CONV, stickerId: STICKER, expectedRevision: 3, expectedPriceFgc: 5000, idempotencyKey: "gift_abcdef123456", pin: "123456", ...over });
let rpcArgs: Record<string, unknown> | null;
let sendAnswer: Record<string, unknown>;

beforeEach(() => {
  db = fakeDb({ settings: [{ key: "landing", value: { frenzGift: { gifting: RULES } } }], financial_audit_log: [] });
  sessionUser = { id: SENDER };
  admin = null;
  reauthed = false;
  pinOk = true;
  coinEnabled = true;
  rpcArgs = null;
  sendMessage.mockClear();
  afterCalls.length = 0;
  dispatched.length = 0;
  sendAnswer = { ok: true, duplicate: false, gift_id: GIFT, recipient_id: "00000000-0000-4000-8000-000000000002", conversation_id: CONV, message_client_id: `gift-${GIFT}`, sticker_id: STICKER, revision: 3, price: 5000, recipient_share: 4500, commission: 500, hold_until: "2026-10-30T10:00:00Z", balance_after: 15_000, sticker: { name: "Red Rose", image_url: "https://cdn.example.test/r.webp", animation_url: null, rarity: "rare" } };
  db.rpc.send_gift_with_pin = (a) => ((rpcArgs = a), { data: sendAnswer, error: null });
  db.rpc.gift_sticker_gallery = () => ({ data: [{ id: STICKER, revision: 3, name: "Red Rose", description: null, rarity: "rare", category: "love", featured: true, price_fgc: 5000, image_url: "https://cdn.example.test/r.webp", animation_url: null }], error: null });
  db.rpc.gift_wallet_summary = () => ({ data: { ok: true, available: 20_000, pending: 4500, next_release_at: null }, error: null });
  db.rpc.save_frenz_gift_gifting = (a) => (a.p_expected_version === 2 ? { data: { ok: true, version: 3, gifting: { ...RULES, version: 3, holdHours: (a.p_rules as { holdHours: number }).holdHours } }, error: null } : { data: { ok: false, reason: "stale", version: 2 }, error: null });
  db.rpc.reverse_gift = () => ({ data: { ok: true, gift_id: GIFT, refunded: 5000 }, error: null });
});

describe("GET /api/gift/gallery", () => {
  it("needs a session", async () => {
    sessionUser = null;
    expect((await gallery.GET()).status).toBe(401);
  });
  it("returns the published stickers, the FGC wallet and whether gifting is configured", async () => {
    const res = await gallery.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stickers: [{ id: STICKER, revision: 3, priceFgc: 5000, rarity: "rare", category: "love", featured: true }], wallet: { available: 20_000, pending: 4500 }, giftingReady: true });
  });
  it("says gifting isn't ready when no rules are saved", async () => {
    db.tables.settings = [{ key: "landing", value: {} }];
    expect(await (await gallery.GET()).json()).toMatchObject({ giftingReady: false });
  });
});

describe("POST /api/gift/send", () => {
  it("needs a session", async () => {
    sessionUser = null;
    expect((await send.POST(post(body()))).status).toBe(401);
    expect(rpcArgs).toBeNull();
  });
  it.each([["a recipient share", { recipientShare: 1 }], ["a commission", { commission: 0 }], ["a balance", { balance: 999 }], ["a hold", { holdUntil: "2020-01-01" }], ["a price field of its own", { price: 1 }]])("refuses a body carrying %s (strict)", async (_, extra) => {
    expect((await send.POST(post(body(extra)))).status).toBe(400);
    expect(rpcArgs).toBeNull();
  });
  it("refuses when Frenz Coin is off", async () => {
    coinEnabled = false;
    expect((await send.POST(post(body()))).status).toBe(503);
  });
  it("a refused PIN: 403, and the database is never asked to move money", async () => {
    pinOk = false;
    const res = await send.POST(post(body()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "authorization_failed" });
    expect(rpcArgs).toBeNull();
  });
  it("sends the PIN proof, what the member saw, and the SERVER's rules — then posts the gift message with the gift's client id", async () => {
    const res = await send.POST(post(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, giftId: GIFT, priceFgc: 5000, messageId: "msg-1" });
    expect(rpcArgs).toMatchObject({ p_sender: SENDER, p_attempt: "att-1", p_conversation: CONV, p_recipient: null, p_sticker: STICKER, p_expected_revision: 3, p_expected_price: 5000, p_idempotency: "gift_abcdef123456", p_rules: RULES });
    expect(sendMessage).toHaveBeenCalledWith(SENDER, CONV, "Sent a sticker gift: Red Rose", expect.objectContaining({ clientId: `gift-${GIFT}`, metadata: expect.objectContaining({ kind: "gift", giftId: GIFT, priceFgc: 5000, name: "Red Rose" }) }));
    // Part 4.1: the recipient's push and email are scheduled AFTER the response, for this gift
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]!();
    expect(dispatched).toEqual([GIFT]);
  });
  it("a replay answers the same gift and re-posts the message with the same client id (never a second message or charge)", async () => {
    sendAnswer = { ...sendAnswer, duplicate: true };
    const res = await send.POST(post(body()));
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true, giftId: GIFT });
    expect(sendMessage.mock.calls[0]![3]).toMatchObject({ clientId: `gift-${GIFT}` });
  });
  it("a changed sticker: 409 with the current revision and price for the member to confirm", async () => {
    sendAnswer = { ok: false, reason: "sticker_changed", revision: 4, price: 6000 };
    const res = await send.POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "sticker_changed", current: { revision: 4, priceFgc: 6000 } });
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it.each([["insufficient", 402], ["blocked", 403], ["secret_chat", 400], ["recipient_required", 400], ["gifting_not_configured", 503], ["deposit_cooldown", 403], ["authorization_failed", 403]])("a database refusal (%s) is answered %i, with no message", async (reason, status) => {
    sendAnswer = { ok: false, reason };
    const res = await send.POST(post(body()));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ reason });
    expect(sendMessage).not.toHaveBeenCalled();
    // a refused gift is never announced
    expect(afterCalls).toHaveLength(0);
  });
});

describe("/api/admin/gift/gifting", () => {
  const rules = { recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 10_000_000 };
  it("a member can neither read nor save", async () => {
    expect((await gifting.GET()).status).toBe(403);
    expect((await gifting.POST(post({ ...rules, expectedVersion: 2 }))).status).toBe(403);
  });
  it("saving needs a fresh password", async () => {
    admin = { id: "admin-1" };
    const res = await gifting.POST(post({ ...rules, expectedVersion: 2 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
  });
  it("invalid rules never reach the database and the refusal is audited; the client can't send a version", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    const bad = await gifting.POST(post({ ...rules, commissionBp: 1100, expectedVersion: 2 }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ detail: "gifting_invalid:split" });
    expect(db.tables.financial_audit_log!.map((r) => r.action)).toContain("gift_gifting_config_rejected");
    expect((await gifting.POST(post({ ...rules, version: 9, expectedVersion: 2 }))).status).toBe(400);
  });
  it("a valid save; a stale one is 409", async () => {
    admin = { id: "admin-1" };
    reauthed = true;
    const ok = await gifting.POST(post({ ...rules, holdHours: 96, expectedVersion: 2 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, version: 3, gifting: { holdHours: 96 } });
    expect((await gifting.POST(post({ ...rules, expectedVersion: 1 }))).status).toBe(409);
  });
});

describe("/api/admin/gift/gifts", () => {
  it("a member can't list or reverse", async () => {
    expect((await gifts.GET()).status).toBe(403);
    expect((await gifts.POST(post({ giftId: GIFT, reason: "x" }))).status).toBe(403);
  });
  it("reversing needs a fresh password and a reason", async () => {
    admin = { id: "admin-1" };
    expect((await gifts.POST(post({ giftId: GIFT, reason: "chargeback" }))).status).toBe(403);
    reauthed = true;
    expect((await gifts.POST(post({ giftId: GIFT, reason: "   " }))).status).toBe(400);
    expect((await gifts.POST(post({ giftId: GIFT, reason: "chargeback" }))).status).toBe(200);
  });
});
