import "server-only";

import { type GiftSticker, stickerFieldProblem, type StickerFields, stickerFromRow } from "@/lib/gift/stickers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Frenz Gift Coin Part 3 (0291): the admin's reads and writes of the sticker catalogue. Every write is the database
 * function admin_save_gift_sticker (validation, revision check, history and audit in one transaction). Nothing here
 * deletes: "remove from the gallery" is `archived: true`.
 */

const MISSING = /gift_stickers|admin_save_gift_sticker|could not find the function|does not exist|schema cache/i;
const NOT_READY = "The sticker catalogue needs migration 0291.";

export type StickerList = { ok: true; stickers: GiftSticker[] } | { ok: false; status: number; error: string };

export async function listStickers(): Promise<StickerList> {
  const { data, error } = await createAdminClient().from("gift_stickers").select("*").order("archived_at", { ascending: true, nullsFirst: true }).order("sort_order").order("created_at").limit(500);
  if (error) return { ok: false, status: 503, error: MISSING.test(error.message) ? NOT_READY : "Couldn't load the stickers." };
  return { ok: true, stickers: ((data ?? []) as Record<string, unknown>[]).map(stickerFromRow) };
}

export interface StickerRevision {
  revision: number;
  name: string;
  priceFgc: number;
  published: boolean;
  archivedAt: string | null;
  changed: string[];
  changedBy: string | null;
  at: string;
}

export async function stickerHistory(id: string): Promise<{ ok: true; revisions: StickerRevision[] } | { ok: false; status: number; error: string }> {
  const { data, error } = await createAdminClient().from("gift_sticker_revisions").select("revision, name, price_fgc, published, archived_at, changed, changed_by, created_at").eq("sticker_id", id).order("revision", { ascending: false }).limit(100);
  if (error) return { ok: false, status: 503, error: MISSING.test(error.message) ? NOT_READY : "Couldn't load the history." };
  return {
    ok: true,
    revisions: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      revision: Number(r.revision),
      name: String(r.name),
      priceFgc: Number(r.price_fgc),
      published: r.published === true,
      archivedAt: typeof r.archived_at === "string" ? r.archived_at : null,
      changed: Array.isArray(r.changed) ? (r.changed as string[]) : [],
      changedBy: typeof r.changed_by === "string" ? r.changed_by : null,
      at: String(r.created_at),
    })),
  };
}

const REFUSED: Record<string, [number, string]> = {
  slug_taken: [409, "Another sticker already uses that slug."],
  needs_artwork: [400, "Add artwork before publishing."],
  archived: [400, "Restore the sticker before publishing it."],
  stale: [409, "Someone changed this sticker while you were editing. Reload it and try again."],
  not_found: [404, "That sticker doesn't exist."],
};

export type StickerSave = { ok: true; sticker: GiftSticker; unchanged: boolean; changed: string[] } | { ok: false; status: number; error: string; field?: string };

/** Create (id null) or change a sticker. */
export async function saveSticker(input: { adminId: string; id: string | null; expectedRevision: number | null; fields: StickerFields }): Promise<StickerSave> {
  const problem = stickerFieldProblem(input.fields, input.id === null);
  if (problem) return { ok: false, status: 400, error: problem.message, field: problem.field };
  const { data, error } = await createAdminClient().rpc("admin_save_gift_sticker", { p_admin: input.adminId, p_id: input.id, p_expected_revision: input.expectedRevision, p_fields: input.fields });
  if (error) {
    if (MISSING.test(error.message)) return { ok: false, status: 503, error: `${NOT_READY} Nothing was saved.` };
    console.error("[gift/stickers] save failed", { code: error.code });
    return { ok: false, status: 503, error: "Couldn't save the sticker. Nothing was changed." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; field?: string; sticker?: Record<string, unknown>; unchanged?: boolean; changed?: string[] };
  if (!r.ok || !r.sticker) {
    if (r.reason === "invalid") return { ok: false, status: 400, error: `The database refused the ${r.field ?? "request"} field.`, field: r.field };
    const [status, msg] = REFUSED[r.reason ?? ""] ?? [409, "That couldn't be saved."];
    return { ok: false, status, error: msg };
  }
  return { ok: true, sticker: stickerFromRow(r.sticker), unchanged: !!r.unchanged, changed: r.changed ?? [] };
}
