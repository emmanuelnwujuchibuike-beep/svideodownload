import "server-only";

import { isCoinTransferAuthorized, type CoinTransferAuthorization } from "@/lib/coin/authorization";
import type { FrenzCoinConfig } from "@/lib/coin/config";
import { pinPolicy } from "@/lib/coin/pin";
import { isGiftQuantity, normalizeGiftNote } from "@/lib/gift/batch";
import { giftCommentId } from "@/lib/gift/comment-gifts";
import { checkGiftingRules, type GiftingCheck } from "@/lib/gift/gifting-rules";
import { sendMessage } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — THE SERVER'S DOOR TO STICKER GIFTS (Frenz Gift Coin Part 4, 0293)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Thin by design, like lib/coin/server.ts: every rule that protects money is decided in the database under both wallet
 * locks (send_gift_with_pin → send_gift). The member sends a conversation, a sticker, the revision and price they were
 * shown, an optional recipient (required in a group), an idempotency key and their PIN. Never a share, a commission, a
 * balance or a hold time — those are the database's, from the administrator's saved rules.
 *
 * The chat message is sent AFTER the gift committed, through the ordinary sendMessage, with the gift's own client id
 * ('gift-<id>'). That id is the idempotency anchor: a retry of the same key answers the same gift (never charged twice)
 * and the message is sent again with the same client id, which sendMessage answers with the message it already made.
 * messages_gift_guard (0293) refuses a gift message that doesn't match a real gift of that sender in that chat.
 */

const MISSING = /send_gift_batch|send_gift|gift_sticker_gallery|gift_wallet_summary|gift_sends|could not find the function|does not exist|schema cache/i;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
// a batch key: copy i is stored as <key>-<i>, and a gift key is at most 80 characters (0296)
const BATCH_KEY = /^[A-Za-z0-9_-]{8,76}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's current gifting rules, checked. A read failure is answered as not configured (fail closed). */
export async function loadGiftingRules(): Promise<GiftingCheck> {
  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", "landing").maybeSingle();
    if (error) return checkGiftingRules(null);
    return checkGiftingRules(((data?.value ?? null) as { frenzGift?: { gifting?: unknown } } | null)?.frenzGift?.gifting ?? null);
  } catch {
    return checkGiftingRules(null);
  }
}

export interface GalleryItem {
  id: string;
  revision: number;
  name: string;
  description: string | null;
  rarity: "common" | "rare" | "epic" | "legendary";
  category: string | null;
  featured: boolean;
  priceFgc: number;
  imageUrl: string | null;
  animationUrl: string | null;
}
export interface GiftWallet {
  /** FGC minor units */
  available: number;
  pending: number;
  nextReleaseAt: string | null;
}
export type GalleryResult = { ok: true; stickers: GalleryItem[]; wallet: GiftWallet; giftingReady: boolean } | { ok: false; status: number; error: string };

/** The published catalogue, the member's FGC wallet (due earnings released first) and whether gifting is configured. */
export async function giftGallery(userId: string): Promise<GalleryResult> {
  const db = createAdminClient();
  const [gallery, wallet, rules] = await Promise.all([db.rpc("gift_sticker_gallery"), db.rpc("gift_wallet_summary", { p_user: userId }), loadGiftingRules()]);
  if (gallery.error || wallet.error) {
    const msg = `${gallery.error?.message ?? ""} ${wallet.error?.message ?? ""}`;
    return { ok: false, status: 503, error: MISSING.test(msg) ? "Sticker gifts arrive with the next update." : "Couldn't load the stickers." };
  }
  const rows = (Array.isArray(gallery.data) ? gallery.data : []) as Record<string, unknown>[];
  const w = (wallet.data ?? {}) as { available?: number; pending?: number; next_release_at?: string | null };
  return {
    ok: true,
    stickers: rows.map((r) => ({
      id: String(r.id),
      revision: Number(r.revision),
      name: String(r.name),
      description: typeof r.description === "string" ? r.description : null,
      rarity: (["rare", "epic", "legendary"].includes(String(r.rarity)) ? r.rarity : "common") as GalleryItem["rarity"],
      category: typeof r.category === "string" ? r.category : null,
      featured: r.featured === true,
      priceFgc: Number(r.price_fgc),
      imageUrl: typeof r.image_url === "string" ? r.image_url : null,
      animationUrl: typeof r.animation_url === "string" ? r.animation_url : null,
    })),
    wallet: { available: Number(w.available ?? 0), pending: Number(w.pending ?? 0), nextReleaseAt: w.next_release_at ?? null },
    giftingReady: rules.ok,
  };
}

const REFUSED: Record<string, [number, string]> = {
  invalid: [400, "That request isn't valid."],
  gifting_not_configured: [503, "Sticker gifts aren't available yet. Nothing was sent."],
  gifting_invalid: [503, "Sticker gifts aren't configured correctly. Nothing was sent."],
  conversation_unavailable: [404, "You can't send a gift in this chat."],
  secret_chat: [400, "Gifts can't be sent in secret chats."],
  admins_only: [403, "Only admins can send in this group."],
  recipient_required: [400, "Choose who the gift is for."],
  recipient_invalid: [400, "That person can't receive a gift in this chat."],
  self: [400, "You can't send a gift to yourself."],
  blocked: [403, "You can't send a gift to this person."],
  recipient_unavailable: [409, "That person can't receive gifts right now."],
  sticker_unavailable: [409, "That sticker isn't available any more."],
  sticker_changed: [409, "That sticker's price just changed. Check it and try again."],
  below_minimum: [400, "That sticker is too small to gift."],
  suspended: [403, "Gifting is paused on this account."],
  restricted: [403, "Gifting is paused on this account."],
  recovery_due: [403, "Paused while a refunded payment is settled. Contact support."],
  deposit_under_review: [403, "Paused while a payment is under review. Contact support."],
  deposit_cooldown: [403, "Gifting opens a little while after a deposit. Try again later."],
  daily_limit: [429, "That would pass your daily gifting limit."],
  insufficient: [402, "Not enough available Gift Coins for this sticker."],
  idempotency_conflict: [409, "That request key was already used. Try again."],
  quantity_invalid: [400, "Choose from 1 to 10 gifts."],
  note_too_long: [400, "Keep the note to 200 characters."],
  note_invalid: [400, "That note can't be sent. Use plain text on one line."],
  authorization_required: [403, "Confirm this gift with your transaction PIN. Nothing was sent."],
  authorization_failed: [403, "That PIN wasn't accepted. Check it, or try again later. Nothing was sent."],
  post_unavailable: [404, "That post isn't available any more. Nothing was sent."],
};

const refuse = (reason: string, extra: Record<string, unknown> = {}) => {
  const [status, error] = REFUSED[reason] ?? [409, "That couldn't be done. Nothing was sent."];
  return { ok: false as const, status, reason, error, ...extra };
};

export type SendGiftResult =
  | { ok: true; giftId: string; duplicate: boolean; priceFgc: number; recipientId: string; messageId: string | null; balanceAfter: number | null; holdUntil: string }
  | { ok: false; status: number; reason: string; error: string; current?: { revision: number; priceFgc: number } };

/** Send a sticker gift: only with a PIN proof issued for THIS sender for a GIFT (checked here and in the database). */
export async function sendGift(input: {
  senderId: string;
  conversationId: string;
  recipientId: string | null;
  stickerId: string;
  expectedRevision: number;
  expectedPriceFgc: number;
  idempotencyKey: string;
  authorization: CoinTransferAuthorization | null;
  config: FrenzCoinConfig;
  rules: GiftingCheck;
}): Promise<SendGiftResult> {
  if (!isCoinTransferAuthorized(input.authorization, input.senderId, "gift")) return refuse("authorization_required");
  if (!UUID.test(input.conversationId) || !UUID.test(input.stickerId) || (input.recipientId !== null && !UUID.test(input.recipientId))) return refuse("invalid");
  if (!KEY.test(input.idempotencyKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.expectedPriceFgc) || input.expectedPriceFgc < 1) return refuse("invalid");
  const auth = input.authorization!;
  const db = createAdminClient();
  // the rules are sent even when missing: the database answers a REPLAY first, and refuses a new gift without rules
  const { data, error } = await db.rpc("send_gift_with_pin", {
    p_sender: input.senderId,
    p_attempt: auth.attemptId,
    p_derived: auth.keyHex,
    p_conversation: input.conversationId,
    p_recipient: input.recipientId,
    p_sticker: input.stickerId,
    p_expected_revision: input.expectedRevision,
    p_expected_price: input.expectedPriceFgc,
    p_idempotency: input.idempotencyKey,
    p_rules: input.rules.ok ? input.rules.rules : null,
    p_policy: pinPolicy(input.config),
  });
  if (error) {
    if (MISSING.test(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Sticker gifts arrive with the next update." };
    console.error("[gift/send] failed", { sender: input.senderId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't send the gift right now. Nothing was taken." };
  }
  const r = (data ?? {}) as {
    ok?: boolean; reason?: string; duplicate?: boolean; gift_id?: string; recipient_id?: string; conversation_id?: string; message_client_id?: string; sticker_id?: string;
    revision?: number; price?: number; hold_until?: string; balance_after?: number; sticker?: { name?: string; image_url?: string | null; animation_url?: string | null; rarity?: string };
  };
  if (!r.ok || !r.gift_id) {
    if (r.reason === "sticker_changed") return refuse("sticker_changed", { current: { revision: Number(r.revision), priceFgc: Number(r.price) } });
    return refuse(r.reason ?? "error");
  }
  const messageId = await postGiftMessage({ senderId: input.senderId, conversationId: r.conversation_id ?? input.conversationId, clientId: r.message_client_id ?? `gift-${r.gift_id}`, gift: r });
  return {
    ok: true,
    giftId: r.gift_id,
    duplicate: !!r.duplicate,
    priceFgc: Number(r.price),
    recipientId: String(r.recipient_id),
    messageId,
    balanceAfter: r.balance_after === undefined ? null : Number(r.balance_after),
    holdUntil: String(r.hold_until),
  };
}

export type SendGiftBatchResult =
  | { ok: true; batchId: string; giftId: string; giftIds: string[]; quantity: number; duplicate: boolean; priceFgc: number; totalFgc: number; recipientId: string; messageId: string | null; balanceAfter: number | null; holdUntil: string }
  | { ok: false; status: number; reason: string; error: string; current?: { revision: number; priceFgc: number }; failedAt?: number };

/**
 * Part 6 (0296): several copies of one sticker in ONE database transaction (send_gift_batch), each its own gift. No PIN
 * (owner, 2026-10-27: "send a gift like a normal sticker" — the sheet asks "are you sure?" instead); the caller passes
 * the SIGNED-IN member as the sender, and every money and chat rule is still the database's. The total is never taken
 * from the client: the member sends the unit price they were SHOWN, the database refuses if it changed, and multiplies.
 * One chat bubble per batch, on the first gift (idempotent on its client id), stating the quantity and the note.
 */
export async function sendGiftBatch(input: {
  senderId: string;
  conversationId: string;
  recipientId: string | null;
  stickerId: string;
  expectedRevision: number;
  expectedPriceFgc: number;
  quantity: number;
  note: string | null;
  idempotencyKey: string;
  rules: GiftingCheck;
}): Promise<SendGiftBatchResult> {
  if (!UUID.test(input.conversationId) || !UUID.test(input.stickerId) || (input.recipientId !== null && !UUID.test(input.recipientId))) return refuse("invalid");
  if (!BATCH_KEY.test(input.idempotencyKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.expectedPriceFgc) || input.expectedPriceFgc < 1) return refuse("invalid");
  if (!isGiftQuantity(input.quantity)) return refuse("quantity_invalid");
  const note = normalizeGiftNote(input.note);
  if (!note.ok) return refuse(note.reason);
  const { data, error } = await createAdminClient().rpc("send_gift_batch", {
    p_sender: input.senderId,
    p_conversation: input.conversationId,
    p_recipient: input.recipientId,
    p_sticker: input.stickerId,
    p_expected_revision: input.expectedRevision,
    p_expected_price: input.expectedPriceFgc,
    p_quantity: input.quantity,
    p_note: note.note,
    p_idempotency: input.idempotencyKey,
    p_rules: input.rules.ok ? input.rules.rules : null,
  });
  if (error) {
    if (MISSING.test(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Sending several gifts arrives with the next update." };
    // never the note, never the body: who and the database's code
    console.error("[gift/batch] failed", { sender: input.senderId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't send the gift right now. Nothing was taken." };
  }
  const r = (data ?? {}) as {
    ok?: boolean; reason?: string; duplicate?: boolean; batch_id?: string; gift_id?: string; gift_ids?: string[]; quantity?: number; recipient_id?: string; conversation_id?: string;
    message_client_id?: string; sticker_id?: string; revision?: number; price?: number; total?: number; note?: string | null; hold_until?: string; balance_after?: number; failed_at?: number;
    sticker?: { name?: string; image_url?: string | null; animation_url?: string | null; rarity?: string };
  };
  if (!r.ok || !r.batch_id || !r.gift_id) {
    if (r.reason === "sticker_changed") return refuse("sticker_changed", { current: { revision: Number(r.revision), priceFgc: Number(r.price) }, failedAt: r.failed_at });
    return refuse(r.reason ?? "error", r.failed_at ? { failedAt: r.failed_at } : {});
  }
  const quantity = Number(r.quantity);
  const messageId = await postGiftMessage({
    senderId: input.senderId,
    conversationId: r.conversation_id ?? input.conversationId,
    clientId: r.message_client_id ?? `gift-${r.gift_id}`,
    gift: { gift_id: r.gift_id, recipient_id: r.recipient_id, sticker_id: r.sticker_id, revision: r.revision, price: r.price, sticker: r.sticker },
    batch: { quantity, note: r.note ?? null },
  });
  return {
    ok: true,
    batchId: r.batch_id,
    giftId: r.gift_id,
    giftIds: Array.isArray(r.gift_ids) ? r.gift_ids.map(String) : [r.gift_id],
    quantity,
    duplicate: !!r.duplicate,
    priceFgc: Number(r.price),
    totalFgc: Number(r.total),
    recipientId: String(r.recipient_id),
    messageId,
    balanceAfter: r.balance_after === undefined ? null : Number(r.balance_after),
    holdUntil: String(r.hold_until),
  };
}

export type SendPlaceGiftResult =
  | { ok: true; batchId: string; giftId: string; giftIds: string[]; quantity: number; duplicate: boolean; priceFgc: number; totalFgc: number; recipientId: string; commentId: string | null; balanceAfter: number | null }
  | { ok: false; status: number; reason: string; error: string; current?: { revision: number; priceFgc: number }; failedAt?: number };

/**
 * 0304 — a gift sent on a POST (a feed post, or an exclusive post) lives on that post, never in a chat (owner,
 * 2026-10-28: "make gift sent from comment show in comment not chat"). The same batch, the same money rules
 * (send_place_gift_batch → send_gift_batch → send_gift), with the post's creator as the recipient — so the creator's
 * MESSAGE setting no longer decides whether their post can be gifted. After the gift commits, ONE comment shows it
 * (the batch's first gift): a feed post's is a post_comments row with sticker `gf:<gift id>`, an exclusive post's a
 * sub_post_comments row with gift_id. The caller checks an exclusive post is visible to the sender first.
 */
export async function sendPlaceGiftBatch(input: {
  senderId: string;
  kind: "post" | "sub_post";
  placeId: string;
  stickerId: string;
  expectedRevision: number;
  expectedPriceFgc: number;
  quantity: number;
  note: string | null;
  idempotencyKey: string;
  rules: GiftingCheck;
}): Promise<SendPlaceGiftResult> {
  if (!UUID.test(input.placeId) || !UUID.test(input.stickerId)) return refuse("invalid");
  if (!BATCH_KEY.test(input.idempotencyKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.expectedPriceFgc) || input.expectedPriceFgc < 1) return refuse("invalid");
  if (!isGiftQuantity(input.quantity)) return refuse("quantity_invalid");
  const note = normalizeGiftNote(input.note);
  if (!note.ok) return refuse(note.reason);
  const { data, error } = await createAdminClient().rpc("send_place_gift_batch", {
    p_sender: input.senderId,
    p_kind: input.kind,
    p_place: input.placeId,
    p_sticker: input.stickerId,
    p_expected_revision: input.expectedRevision,
    p_expected_price: input.expectedPriceFgc,
    p_quantity: input.quantity,
    p_note: note.note,
    p_idempotency: input.idempotencyKey,
    p_rules: input.rules.ok ? input.rules.rules : null,
  });
  if (error) {
    if (MISSING.test(error.message) || /send_place_gift_batch/.test(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Gifts on posts arrive with the next update." };
    console.error("[gift/place] failed", { sender: input.senderId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't send the gift right now. Nothing was taken." };
  }
  const r = (data ?? {}) as {
    ok?: boolean; reason?: string; duplicate?: boolean; batch_id?: string; gift_id?: string; gift_ids?: string[]; quantity?: number; recipient_id?: string;
    revision?: number; price?: number; total?: number; note?: string | null; balance_after?: number; failed_at?: number;
    sticker?: { name?: string };
  };
  if (!r.ok || !r.batch_id || !r.gift_id) {
    if (r.reason === "sticker_changed") return refuse("sticker_changed", { current: { revision: Number(r.revision), priceFgc: Number(r.price) }, failedAt: r.failed_at });
    return refuse(r.reason ?? "error", r.failed_at ? { failedAt: r.failed_at } : {});
  }
  const commentId = await postGiftComment({ kind: input.kind, placeId: input.placeId, senderId: input.senderId, giftId: r.gift_id, note: r.note ?? null, name: r.sticker?.name ?? "a sticker" });
  return {
    ok: true,
    batchId: r.batch_id,
    giftId: r.gift_id,
    giftIds: Array.isArray(r.gift_ids) ? r.gift_ids.map(String) : [r.gift_id],
    quantity: Number(r.quantity),
    duplicate: !!r.duplicate,
    priceFgc: Number(r.price),
    totalFgc: Number(r.total),
    recipientId: String(r.recipient_id),
    commentId,
    balanceAfter: r.balance_after === undefined ? null : Number(r.balance_after),
  };
}

/** The comment that shows a post gift — once per gift (a replay finds the one already there). Never touches the gift. */
async function postGiftComment(input: { kind: "post" | "sub_post"; placeId: string; senderId: string; giftId: string; note: string | null; name: string }): Promise<string | null> {
  const db = createAdminClient();
  try {
    if (input.kind === "post") {
      const sticker = giftCommentId(input.giftId);
      const { data: existing } = await db.from("post_comments").select("id").eq("post_id", input.placeId).eq("sticker", sticker).maybeSingle();
      if (existing) return (existing as { id: string }).id;
      const { data, error } = await db.from("post_comments").insert({ post_id: input.placeId, author_id: input.senderId, parent_id: null, body: input.note ?? "", sticker }).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    }
    const { data: existing } = await db.from("sub_post_comments").select("id").eq("gift_id", input.giftId).maybeSingle();
    if (existing) return (existing as { id: string }).id;
    // the table needs 1 to 1,000 characters: the note, or what was sent
    const body = (input.note ?? `Sent a sticker gift: ${input.name}`).slice(0, 1000);
    const { data, error } = await db.from("sub_post_comments").insert({ post_id: input.placeId, user_id: input.senderId, body, gift_id: input.giftId }).select("id").single();
    if (error) throw error;
    return (data as { id: string }).id;
  } catch (e) {
    console.error("[gift/place] comment not posted", { gift: input.giftId, code: (e as { code?: string } | null)?.code ?? null });
    return null;
  }
}

/** The gift's chat message (idempotent on the gift's client id). A failure here never touches the gift: retrying posts it. */
async function postGiftMessage(input: {
  senderId: string;
  conversationId: string;
  clientId: string;
  gift: { gift_id?: string; recipient_id?: string; sticker_id?: string; revision?: number; price?: number; sticker?: { name?: string; image_url?: string | null; animation_url?: string | null; rarity?: string } };
  /** 0296: a batch's bubble states its quantity and note — the database's own (messages_gift_guard checks both) */
  batch?: { quantity: number; note: string | null };
}): Promise<string | null> {
  const g = input.gift;
  const name = g.sticker?.name ?? "a sticker";
  const sent = await sendMessage(input.senderId, input.conversationId, `Sent a sticker gift: ${name}`.slice(0, 200), {
    clientId: input.clientId,
    metadata: {
      kind: "gift",
      giftId: g.gift_id,
      recipientId: g.recipient_id,
      stickerId: g.sticker_id,
      revision: g.revision,
      name,
      imageUrl: g.sticker?.image_url ?? null,
      animationUrl: g.sticker?.animation_url ?? null,
      rarity: g.sticker?.rarity ?? "common",
      priceFgc: g.price,
      // the note is in the chat (the sender's words to the recipient), never in the body the inbox and push previews read
      ...(input.batch ? { quantity: input.batch.quantity, ...(input.batch.note ? { note: input.batch.note } : {}) } : {}),
    },
  });
  if (!sent.ok) console.error("[gift/send] message not posted", { gift: g.gift_id, reason: sent.reason ?? null });
  return sent.ok ? sent.id : null;
}

/** Make due earnings spendable before an FGC spend or conversion (idempotent, never throws, fails safe). */
export async function releaseGiftEarnings(userId: string): Promise<void> {
  try {
    await createAdminClient().rpc("release_gift_earnings", { p_user: userId });
  } catch {
    /* not yet migrated, or a transient error: earnings simply stay pending until the next read */
  }
}

// ── administrators ───────────────────────────────────────────────────────────

export interface PendingGiftRow {
  id: string;
  senderId: string;
  recipientId: string;
  priceFgc: number;
  recipientShare: number;
  commission: number;
  holdUntil: string;
  stickerName: string;
  createdAt: string;
}

/** Pending gifts, those whose hold has passed first (they are waiting on a sender under review, or the next read). */
export async function listPendingGifts(): Promise<{ ok: true; gifts: PendingGiftRow[] } | { ok: false; status: number; error: string }> {
  const { data, error } = await createAdminClient().from("gift_sends").select("id, sender_id, recipient_id, price_fgc, recipient_share, commission, hold_until, sticker_snapshot, created_at").eq("status", "pending").order("hold_until").limit(200);
  if (error) return { ok: false, status: 503, error: MISSING.test(error.message) ? "Sticker gifts need migration 0293." : "Couldn't load the gifts." };
  return {
    ok: true,
    gifts: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      senderId: String(r.sender_id),
      recipientId: String(r.recipient_id),
      priceFgc: Number(r.price_fgc),
      recipientShare: Number(r.recipient_share),
      commission: Number(r.commission),
      holdUntil: String(r.hold_until),
      stickerName: String((r.sticker_snapshot as { name?: string } | null)?.name ?? "Sticker"),
      createdAt: String(r.created_at),
    })),
  };
}

/** An administrator's audited reversal of a PENDING gift (the recipient's pending share back, the sender refunded). */
export async function reverseGift(input: { giftId: string; adminId: string; reason: string }): Promise<{ ok: true; duplicate: boolean } | { ok: false; status: number; error: string }> {
  if (!UUID.test(input.giftId)) return { ok: false, status: 400, error: "Bad gift id." };
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 1 || reason.length > 300) return { ok: false, status: 400, error: "Give a reason (up to 300 characters)." };
  const { data, error } = await createAdminClient().rpc("reverse_gift", { p_gift: input.giftId, p_admin: input.adminId, p_reason: reason });
  if (error) return { ok: false, status: 503, error: MISSING.test(error.message) ? "Sticker gifts need migration 0293." : "Couldn't reverse the gift." };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; duplicate?: boolean };
  if (!r.ok) return { ok: false, status: r.reason === "not_found" ? 404 : 409, error: r.reason === "already_released" ? "Those earnings were already released. A released gift isn't reversed automatically." : "That gift can't be reversed." };
  return { ok: true, duplicate: !!r.duplicate };
}

/** The member's FGC wallet for a page render, due gift earnings released first (gift_wallet_summary). Null = not available. */
export async function giftWalletSummary(userId: string): Promise<GiftWallet | null> {
  const { data, error } = await createAdminClient().rpc("gift_wallet_summary", { p_user: userId });
  if (error) return null;
  const w = (data ?? {}) as { available?: number; pending?: number; next_release_at?: string | null };
  return { available: Number(w.available ?? 0), pending: Number(w.pending ?? 0), nextReleaseAt: w.next_release_at ?? null };
}
