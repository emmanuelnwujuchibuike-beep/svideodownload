import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { giftCommentId, giftCommentUuid, type CommentGift } from "./comment-gifts";

/**
 * The gifts behind a page of comments (`gf:<gift id>` stickers, 0304) — one query for the gifts, one for the
 * recipients' names. Drawn from the gift's own snapshot, so a later sticker edit changes nothing. A reversed gift
 * shows nothing (its comment keeps only the note). Tolerant of 0304 not having run: no gifts, never a failed list.
 */
export async function loadCommentGifts(stickerIds: Iterable<string | null | undefined>): Promise<Map<string, CommentGift>> {
  const out = new Map<string, CommentGift>();
  const uuids = [...new Set([...stickerIds].map(giftCommentUuid).filter((u): u is string => !!u))];
  if (!uuids.length) return out;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("gift_sends")
      .select("id, recipient_id, price_fgc, batch_size, sticker_snapshot, status")
      .in("id", uuids.slice(0, 200))
      .neq("status", "reversed");
    if (error) return out;
    const rows = (data ?? []) as { id: string; recipient_id: string; price_fgc: number; batch_size: number | null; sticker_snapshot: { name?: string; image_url?: string | null; animation_url?: string | null; rarity?: string } | null }[];
    const people = [...new Set(rows.map((r) => r.recipient_id))];
    const { data: profs } = people.length ? await db.from("profiles").select("id, display_name, handle").in("id", people) : { data: [] };
    const nameOf = new Map(((profs ?? []) as { id: string; display_name: string | null; handle: string | null }[]).map((p) => [p.id, p.display_name || (p.handle ? `@${p.handle}` : "the creator")]));
    for (const r of rows) {
      const s = r.sticker_snapshot ?? {};
      out.set(giftCommentId(r.id), {
        giftId: r.id,
        name: s.name ?? "A gift",
        imageUrl: s.image_url ?? null,
        animationUrl: s.animation_url ?? null,
        rarity: s.rarity ?? "common",
        priceFgc: Number(r.price_fgc),
        quantity: Math.max(1, Number(r.batch_size ?? 1)),
        recipientName: nameOf.get(r.recipient_id) ?? "the creator",
      });
    }
  } catch {
    /* 0304 not run yet */
  }
  return out;
}
