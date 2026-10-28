import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { STICKER_RARITIES } from "@/lib/gift/stickers";
import { listStickers, saveSticker, stickerHistory } from "@/lib/gift/stickers-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// shapes only: every bound is stickerFieldProblem's here and gift_sticker_field_problem's in the database
const fields = z
  .object({
    slug: z.string().max(48).optional(),
    name: z.string().max(80).optional(),
    description: z.string().max(400).nullable().optional(),
    rarity: z.enum(STICKER_RARITIES as unknown as [string, ...string[]]).optional(),
    priceFgc: z.number().int().optional(),
    imageUrl: z.string().max(2048).nullable().optional(),
    animationUrl: z.string().max(2048).nullable().optional(),
    category: z.string().max(24).nullable().optional(),
    featured: z.boolean().optional(),
    published: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
const schema = z
  .object({
    id: z.string().regex(UUID).nullable(),
    expectedRevision: z.number().int().min(1).nullable(),
    fields,
  })
  .strict();

/** GET /api/admin/gift/stickers — every sticker (archived last); ?id=<uuid> adds that sticker's revision history. */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null) {
    if (!UUID.test(id)) return NextResponse.json({ error: "Bad sticker id." }, { status: 400 });
    const h = await stickerHistory(id);
    if (!h.ok) return NextResponse.json({ error: h.error }, { status: h.status });
    return NextResponse.json({ revisions: h.revisions }, { headers: { "cache-control": "no-store" } });
  }
  const r = await listStickers();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ stickers: r.stickers }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/admin/gift/stickers — create (id null) or change a sticker: name, description, rarity, price (FGC minor
 * units), artwork, category, featured, published, order, archived. Prices are money: a verified administrator with a
 * fresh password. Validated here and by the database (admin_save_gift_sticker), which writes the revision and the audit
 * rows in the same transaction and refuses a stale revision. Nothing is ever deleted.
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("gift.sticker", null);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ");
    return NextResponse.json({ error: issues ? `Couldn't save — ${issues}` : "Invalid request." }, { status: 400 });
  }
  const { id, expectedRevision, fields: f } = parsed.data;
  if (id !== null && expectedRevision === null) return NextResponse.json({ error: "The revision you were editing is missing. Reload and try again." }, { status: 400 });
  const out = await saveSticker({ adminId: gate.user.id, id, expectedRevision, fields: f as Parameters<typeof saveSticker>[0]["fields"] });
  if (!out.ok) return NextResponse.json({ error: out.error, field: out.field ?? null }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
