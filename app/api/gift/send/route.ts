import { after, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeGift } from "@/lib/coin/authorization";
import { GIFT_BATCH_MAX, GIFT_NOTE_MAX } from "@/lib/gift/batch";
import { dispatchGiftBatchNotifications, dispatchGiftNotifications } from "@/lib/gift/gift-notify";
import { loadGiftingRules, sendGift, sendGiftBatch } from "@/lib/gift/gifts-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter, clientId, pinLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Part 6 (0296) — the batch send: quantity and an optional note, and NO PIN (owner, 2026-10-27: "Users shouldn't have
  to enter a PIN to send a gift, they send a gift like a normal sticker" — the sheet asks "are you sure?" instead, and
  the member may skip that question for a week). The sender is the session; every money and chat rule is the
  database's (send_gift_batch). The note is checked here and again in the database, and never logged.
*/
const batchSchema = z
  .object({
    conversationId: z.string().uuid(),
    recipientId: z.string().uuid().nullable().optional(),
    stickerId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    // the UNIT price the member was shown. The total is the database's (price x quantity), never the client's.
    expectedPriceFgc: z.number().int().positive(),
    quantity: z.number().int().min(1).max(GIFT_BATCH_MAX),
    // generous on the wire (an emoji is two UTF-16 units); the 200-character rule is applied by normalizeGiftNote and the database
    note: z.string().max(GIFT_NOTE_MAX * 4).nullable().optional(),
    idempotencyKey: z.string().max(76),
  })
  .strict();

const schema = z
  .object({
    conversationId: z.string().uuid(),
    // required in a group chat; in a direct chat the other member (and checked if given)
    recipientId: z.string().uuid().nullable().optional(),
    stickerId: z.string().uuid(),
    // what the member was SHOWN: the database refuses the gift if the sticker changed since (sticker_changed)
    expectedRevision: z.number().int().positive(),
    expectedPriceFgc: z.number().int().positive(),
    idempotencyKey: z.string().max(80),
    // the member's six-digit TRANSACTION PIN. Never logged, never stored, never echoed.
    pin: z.string().max(12),
  })
  .strict();

/**
 * POST /api/gift/send — send a sticker gift in a chat. With `quantity` (Part 6, 0296): the batch send above, no PIN.
 * Without it (Part 4, 0293, kept for any client still sending the old body): The sender is the session. The
 * price, the recipient's share, the commission, the hold, the balance and every chat rule (membership, blocks, secret
 * chats, the group recipient) are the database's (send_gift_with_pin, under both wallet locks). Confirmed with the
 * member's TRANSACTION PIN, checked in the database in the same transaction. The idempotency key makes a retry the
 * same gift. The gift message is posted to the chat after the gift committed, with the gift's own client id.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`gift-send:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many gifts — wait a moment.", reason: "rate_limited" }, { status: 429 });
  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (json && typeof json === "object" && "quantity" in json) {
    const b = batchSchema.safeParse(json);
    if (!b.success) {
      const quantityBad = b.error.issues.some((i) => i.path[0] === "quantity");
      return NextResponse.json({ error: quantityBad ? `Choose from 1 to ${GIFT_BATCH_MAX} gifts.` : "Invalid request.", reason: quantityBad ? "quantity_invalid" : "invalid" }, { status: 400 });
    }
    const [settings, rules] = await Promise.all([getLandingSettings(), loadGiftingRules()]);
    if (!settings.frenzCoin.enabled) return NextResponse.json({ error: "Frenz Coin isn't available right now.", reason: "disabled" }, { status: 503 });
    const out = await sendGiftBatch({
      senderId: user.id,
      conversationId: b.data.conversationId,
      recipientId: b.data.recipientId ?? null,
      stickerId: b.data.stickerId,
      expectedRevision: b.data.expectedRevision,
      expectedPriceFgc: b.data.expectedPriceFgc,
      quantity: b.data.quantity,
      note: b.data.note ?? null,
      idempotencyKey: b.data.idempotencyKey,
      rules,
    });
    if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason, ...(out.current ? { current: out.current } : {}) }, { status: out.status });
    // the batch is announced once, on its first gift; every other copy's outbox rows are closed as part of it (0294 / 0296)
    const ids = out.giftIds;
    after(() => dispatchGiftBatchNotifications(ids).then(() => undefined));
    return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request.", reason: "invalid" }, { status: 400 });
  const [settings, rules] = await Promise.all([getLandingSettings(), loadGiftingRules()]);
  const c = settings.frenzCoin;
  if (!c.enabled) return NextResponse.json({ error: "Frenz Coin isn't available right now.", reason: "disabled" }, { status: 503 });
  // PIN guesses: per member and per IP (the database counter is the durable limit behind these)
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin:${user.id}`), pinLimiter.limit(`coin-pin-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment.", reason: "rate_limited" }, { status: 429 });
  const auth = await authorizeGift(user.id, parsed.data.pin, c);
  if (!auth.ok) {
    if (auth.reason === "unavailable") return NextResponse.json({ error: "Gifts aren't available right now. Nothing was sent.", reason: "authorization_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "That PIN wasn't accepted. Check it, or try again later. Nothing was sent.", reason: "authorization_failed" }, { status: 403 });
  }
  const out = await sendGift({
    senderId: user.id,
    conversationId: parsed.data.conversationId,
    recipientId: parsed.data.recipientId ?? null,
    stickerId: parsed.data.stickerId,
    expectedRevision: parsed.data.expectedRevision,
    expectedPriceFgc: parsed.data.expectedPriceFgc,
    idempotencyKey: parsed.data.idempotencyKey,
    authorization: auth.authorization,
    config: c,
    rules,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason, ...(out.current ? { current: out.current } : {}) }, { status: out.status });
  // Part 4.1: the recipient's push and email, after the response and off the money path (each channel once — 0294 outbox;
  // a replay finds them already sent). A failed notification never touches the gift.
  const giftId = out.giftId;
  after(() => dispatchGiftNotifications(giftId).then(() => undefined));
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
