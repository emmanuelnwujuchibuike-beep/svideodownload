import "server-only";

import { decodeSubCursor, encodeSubCursor, isUuid } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GIFT BOX — A MEMBER'S SENT AND RECEIVED STICKER GIFTS (Frenz Gift Coin Part 5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read-only, from the gift records themselves (gift_sends, 0293) — not a second ledger. Every figure is the one stored on
 * the gift when it was sent: the sticker's name and artwork from sticker_snapshot, the price, the recipient's share, the
 * hold and the status. A sticker edited, re-priced or archived later changes none of it.
 *
 *   received   the gifts this member received: the share they EARNED (not the price the sender paid), and whether it is
 *              still on hold (until hold_until), available (released) or was reversed while pending
 *   sent       the gifts this member sent: the price they paid
 *
 * The member is always the session user (the route passes it); the other side is named by public name/handle only.
 * Newest first, keyset-paged like the coin wallet's activity (lib/coin/wallet.ts). Due earnings are released by the
 * wallet read beside it (gift_wallet_summary), never here.
 */

export type GiftBox = "received" | "sent";
export type GiftHistoryStatus = "pending" | "released" | "reversed";

export interface GiftHistoryItem {
  id: string;
  at: string;
  conversationId: string;
  sticker: { name: string; imageUrl: string | null; rarity: string };
  /** FGC minor units: received = the share earned, sent = the price paid */
  amountFgc: number;
  status: GiftHistoryStatus;
  /** received + pending: when it becomes available */
  holdUntil: string | null;
  other: { name: string; handle: string | null } | null;
  /** Part 6 (0296): the sender's note — on the first gift of its batch only; plain text, rendered as text */
  note: string | null;
  /** Part 6 (0296): this gift's place in the send it was part of (1 of 1 for a gift sent alone) */
  batch: { index: number; size: number };
}

export type GiftHistoryPage = { ok: true; items: GiftHistoryItem[]; next: string | null; counts: { received: number | null; sent: number | null } } | { ok: false; status: number; error: string };

const PAGE = 20;
const MAX_PAGE = 50;
const MISSING = /gift_sends|does not exist|schema cache/i;

type Row = { id: string; sender_id: string; recipient_id: string; conversation_id: string; price_fgc: number; recipient_share: number; status: string; hold_until: string; sticker_snapshot: Record<string, unknown> | null; created_at: string; note?: string | null; batch_index?: number | null; batch_size?: number | null };
const BASE_COLS = "id, sender_id, recipient_id, conversation_id, price_fgc, recipient_share, status, hold_until, sticker_snapshot, created_at";
// 0296 columns: read when present; before 0296 runs the history still answers, without notes
const BATCH_COLS = `${BASE_COLS}, note, batch_index, batch_size`;
const MISSING_BATCH = /note|batch_index|batch_size/i;

export async function giftHistory(userId: string, box: GiftBox, opts: { cursor?: string | null; limit?: number | null } = {}): Promise<GiftHistoryPage> {
  const c = decodeSubCursor(opts.cursor);
  if (c === "invalid" || (c && (!c.id || !isUuid(c.id)))) return { ok: false, status: 400, error: "Bad cursor." };
  const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(opts.limit ?? PAGE)) || PAGE));
  const db = createAdminClient();
  const mine = box === "received" ? "recipient_id" : "sender_id";
  const pageQuery = (cols: string) => {
    let q = db.from("gift_sends").select(cols).eq(mine, userId);
    if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`);
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
  };
  const [first, received, sent] = await Promise.all([
    pageQuery(BATCH_COLS),
    // the summary's counts: only on the first page (a head count, no rows)
    c ? Promise.resolve(null) : db.from("gift_sends").select("id", { count: "exact", head: true }).eq("recipient_id", userId),
    c ? Promise.resolve(null) : db.from("gift_sends").select("id", { count: "exact", head: true }).eq("sender_id", userId),
  ]);
  const page = first.error && MISSING_BATCH.test(first.error.message) ? await pageQuery(BASE_COLS) : first;
  if (page.error) return { ok: false, status: 503, error: MISSING.test(page.error.message) ? "Sticker gifts arrive with the next update." : "Couldn't load your gifts." };
  const rows = ((page.data ?? []) as unknown as Row[]).slice(0, size + 1);
  const items = rows.slice(0, size);
  const otherIds = [...new Set(items.map((r) => (box === "received" ? r.sender_id : r.recipient_id)))];
  const people = otherIds.length ? await db.from("profiles").select("id, handle, display_name").in("id", otherIds) : { data: [] };
  const byId = new Map(((people.data ?? []) as { id: string; handle: string | null; display_name: string | null }[]).map((p) => [p.id, p]));
  const last = items[items.length - 1];
  return {
    ok: true,
    items: items.map((r) => {
      const p = byId.get(box === "received" ? r.sender_id : r.recipient_id);
      const s = r.sticker_snapshot ?? {};
      const status = (["pending", "released", "reversed"].includes(r.status) ? r.status : "pending") as GiftHistoryStatus;
      return {
        id: r.id,
        at: r.created_at,
        conversationId: r.conversation_id,
        sticker: { name: typeof s.name === "string" ? s.name : "Sticker", imageUrl: typeof s.image_url === "string" ? s.image_url : null, rarity: typeof s.rarity === "string" ? s.rarity : "common" },
        amountFgc: Number(box === "received" ? r.recipient_share : r.price_fgc),
        status,
        holdUntil: box === "received" && status === "pending" ? r.hold_until : null,
        other: p ? { name: p.display_name || (p.handle ? `@${p.handle}` : "A member"), handle: p.handle ?? null } : null,
        note: typeof r.note === "string" && r.note ? r.note : null,
        batch: { index: Number(r.batch_index ?? 1), size: Number(r.batch_size ?? 1) },
      };
    }),
    next: rows.length > size && last ? encodeSubCursor(last.created_at, last.id) : null,
    counts: { received: received && "count" in received ? (received.count ?? null) : null, sent: sent && "count" in sent ? (sent.count ?? null) : null },
  };
}
