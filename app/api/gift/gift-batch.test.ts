import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 6 (0296): POST /api/gift/send with a quantity — the batch send. No PIN (owner, 2026-10-27).
 * The database function is scripted here; its own behaviour (atomic batch, rollback, replay, concurrency, the note
 * rules, the bubble guard) is pinned in supabase/tests/0296_gift_batches.pglite.mjs. What these pin: a session is
 * needed, the PIN is NOT asked for, quantity and note are validated BEFORE the database (a bad one never reaches it),
 * the client can't send a total, the bubble is posted once per batch with the database's quantity and note, the batch
 * is announced through the batch dispatcher, and the note never reaches a log.
 */
let db: FakeDb;
let sessionUser: { id: string } | null = null;
const sendMessage = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, id: "msg-1" }));
const authorizeGift = vi.fn(async () => ({ ok: false, reason: "authorization_failed" }));
const afterCalls: (() => unknown)[] = [];
const dispatchedBatches: string[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void afterCalls.push(fn) }));
vi.mock("@/lib/gift/gift-notify", () => ({ dispatchGiftNotifications: async () => ({ push: "sent", email: "sent" }), dispatchGiftBatchNotifications: async (ids: string[]) => (dispatchedBatches.push(ids), { push: "sent", email: "sent" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ aiJobCreateLimiter: { limit: async () => ({ success: true }) }, pinLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/social/messages", () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a) }));
vi.mock("@/lib/landing/settings", async () => ({ getLandingSettings: async () => ({ frenzCoin: { ...(await import("@/lib/coin/config")).COIN_DEFAULTS, enabled: true } }) }));
vi.mock("@/lib/coin/authorization", async (orig) => ({ ...(await orig<typeof import("@/lib/coin/authorization")>()), authorizeGift: () => authorizeGift() }));

const send = await import("@/app/api/gift/send/route");

const SENDER = "00000000-0000-4000-8000-000000000001";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const STICKER = "00000000-0000-4000-8000-0000000000a1";
const BATCH = "00000000-0000-4000-8000-0000000000b1";
const G = ["00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2", "00000000-0000-4000-8000-0000000000f3"];
const RULES = { version: 2, recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 10_000_000 };
const post = (b: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const body = (over: Record<string, unknown> = {}) => ({ conversationId: CONV, stickerId: STICKER, expectedRevision: 3, expectedPriceFgc: 5000, quantity: 3, note: "For you", idempotencyKey: "gift_abcdef123456", ...over });
let rpcArgs: Record<string, unknown> | null;
let answer: Record<string, unknown>;

beforeEach(() => {
  db = fakeDb({ settings: [{ key: "landing", value: { frenzGift: { gifting: RULES } } }] });
  sessionUser = { id: SENDER };
  rpcArgs = null;
  sendMessage.mockClear();
  authorizeGift.mockClear();
  afterCalls.length = 0;
  dispatchedBatches.length = 0;
  answer = { ok: true, duplicate: false, batch_id: BATCH, quantity: 3, gift_id: G[0], gift_ids: G, message_client_id: `gift-${G[0]}`, recipient_id: "00000000-0000-4000-8000-000000000002", conversation_id: CONV, sticker_id: STICKER, revision: 3, price: 5000, total: 15_000, note: "For you", hold_until: "2026-10-30T10:00:00Z", balance_after: 5000, sticker: { name: "Red Rose", image_url: "https://cdn.example.test/r.webp", animation_url: null, rarity: "rare" } };
  db.rpc.send_gift_batch = (a) => ((rpcArgs = a), { data: answer, error: null });
  db.rpc.send_gift_with_pin = () => {
    throw new Error("the PIN path must not be used for a batch");
  };
});

describe("POST /api/gift/send — a batch (quantity)", () => {
  it("needs a session", async () => {
    sessionUser = null;
    expect((await send.POST(post(body()))).status).toBe(401);
    expect(rpcArgs).toBeNull();
  });
  it("no PIN: nothing asks for one, and a body carrying one is refused (strict)", async () => {
    expect((await send.POST(post(body()))).status).toBe(200);
    expect(authorizeGift).not.toHaveBeenCalled();
    expect((await send.POST(post(body({ pin: "123456" })))).status).toBe(400);
  });
  it("sends what the member saw, the quantity, the note and the SERVER's rules — never a total", async () => {
    const res = await send.POST(post(body()));
    expect(await res.json()).toMatchObject({ ok: true, batchId: BATCH, giftId: G[0], giftIds: G, quantity: 3, priceFgc: 5000, totalFgc: 15_000, balanceAfter: 5000 });
    expect(rpcArgs).toMatchObject({ p_sender: SENDER, p_conversation: CONV, p_sticker: STICKER, p_expected_revision: 3, p_expected_price: 5000, p_quantity: 3, p_note: "For you", p_idempotency: "gift_abcdef123456", p_rules: RULES });
    expect((await send.POST(post(body({ totalFgc: 1 })))).status).toBe(400);
  });
  it.each([[0], [-1], [11], [1.5], ["3"], [null]])("quantity %s is refused before the database", async (q) => {
    const res = await send.POST(post(body({ quantity: q })));
    expect(res.status).toBe(400);
    expect(rpcArgs).toBeNull();
  });
  it("notes: missing, empty and whitespace-only send none; exactly 200 is fine; 201 or a control character is refused", async () => {
    await send.POST(post(body({ note: undefined })));
    expect(rpcArgs!.p_note).toBeNull();
    await send.POST(post(body({ note: "" })));
    expect(rpcArgs!.p_note).toBeNull();
    await send.POST(post(body({ note: "    " })));
    expect(rpcArgs!.p_note).toBeNull();
    await send.POST(post(body({ note: "  hi there  " })));
    expect(rpcArgs!.p_note).toBe("hi there");
    await send.POST(post(body({ note: "😀".repeat(200) })));
    expect(rpcArgs!.p_note).toBe("😀".repeat(200));
    rpcArgs = null;
    const long = await send.POST(post(body({ note: "x".repeat(201) })));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ reason: "note_too_long" });
    expect((await send.POST(post(body({ note: "a\u0007b" })))).status).toBe(400);
    expect(rpcArgs).toBeNull();
  });
  it("markup in a note is passed as plain text (it is rendered as text, never HTML)", async () => {
    await send.POST(post(body({ note: "<img src=x onerror=alert(1)>" })));
    expect(rpcArgs!.p_note).toBe("<img src=x onerror=alert(1)>");
  });
  it("ONE bubble per batch, on the first gift's client id, with the database's quantity and note", async () => {
    await send.POST(post(body()));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, , text, opts] = sendMessage.mock.calls[0]! as [string, string, string, { clientId: string; metadata: Record<string, unknown> }];
    expect(opts.clientId).toBe(`gift-${G[0]}`);
    expect(opts.metadata).toMatchObject({ kind: "gift", giftId: G[0], quantity: 3, note: "For you", priceFgc: 5000 });
    // the note is in the bubble only — not in the message body the inbox and push previews read
    expect(text).not.toContain("For you");
  });
  it("a replay re-posts the same bubble (same client id) — never a second message or charge", async () => {
    answer = { ...answer, duplicate: true };
    expect(await (await send.POST(post(body()))).json()).toMatchObject({ duplicate: true, batchId: BATCH });
    expect((sendMessage.mock.calls[0]![3] as { clientId: string }).clientId).toBe(`gift-${G[0]}`);
  });
  it("announced once, through the batch dispatcher, after the response", async () => {
    await send.POST(post(body()));
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]!();
    expect(dispatchedBatches).toEqual([G]);
  });
  it.each([["insufficient", 402], ["daily_limit", 429], ["sticker_unavailable", 409], ["blocked", 403], ["note_invalid", 400], ["idempotency_conflict", 409]])("a database refusal (%s) is %i — no bubble, no announcement", async (reason, status) => {
    answer = { ok: false, reason, quantity: 3, failed_at: 2 };
    const res = await send.POST(post(body()));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ reason });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });
  it("a changed sticker: 409 with the current price to confirm again", async () => {
    answer = { ok: false, reason: "sticker_changed", revision: 4, price: 6000, failed_at: 1 };
    expect(await (await send.POST(post(body()))).json()).toMatchObject({ reason: "sticker_changed", current: { revision: 4, priceFgc: 6000 } });
  });
  it("a database error is logged without the note or the body", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc.send_gift_batch = () => ({ data: null, error: { message: "boom", code: "XX000" } });
    expect((await send.POST(post(body({ note: "secret words" })))).status).toBe(503);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret words");
    errors.mockRestore();
  });
  it("the old body (no quantity) still takes the PIN path, unchanged", async () => {
    const res = await send.POST(post({ conversationId: CONV, stickerId: STICKER, expectedRevision: 3, expectedPriceFgc: 5000, idempotencyKey: "gift_abcdef123456", pin: "123456" }));
    expect(authorizeGift).toHaveBeenCalled();
    expect(res.status).toBe(403);
  });
});
