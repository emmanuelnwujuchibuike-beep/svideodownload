import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { readGiftSettings, saveGiftGifting } from "@/lib/gift/settings-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// whole numbers only: the bounds are checkGiftingRules' (and the database's gift_rules_check), which name the field
const schema = z
  .object({
    recipientShareBp: z.number().int(),
    commissionBp: z.number().int(),
    holdHours: z.number().int(),
    senderCooldownHours: z.number().int(),
    dailyMaxFgc: z.number().int(),
    // the version the administrator was editing (0 = never configured). The server stamps the next one.
    expectedVersion: z.number().int().min(0),
  })
  .strict();

/** GET /api/admin/gift/gifting — the stored gifting rules (or not configured). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = await readGiftSettings();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const s = r.settings;
  return NextResponse.json({ gifting: s.gifting, problem: s.giftingProblem, updatedAt: s.giftingUpdatedAt }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/admin/gift/gifting — save the sticker-gifting rules (recipient share / commission, earnings hold, deposit
 * cooldown, daily limit). A money setting: a verified administrator with a fresh password. Validated here and in the
 * database (save_frenz_gift_gifting: version-checked, audited in the same transaction, under 0292's settings guard).
 * Never adjusted to pass. Gifting stays off until the first valid save.
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("gift.gifting", "frenzGift");
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ");
    return NextResponse.json({ error: fields ? `Couldn't save — ${fields}` : "Invalid request.", reason: "invalid" }, { status: 400 });
  }
  const { expectedVersion, ...fields } = parsed.data;
  const out = await saveGiftGifting({ adminId: gate.user.id, fields, expectedVersion });
  if (!out.ok) {
    if (out.reason === "invalid") await auditAdminAction(gate.user.id, "gift_gifting_config_rejected", "gift.gifting", "frenzGift", { detail: out.detail ?? null, expectedVersion, attempted: fields });
    return NextResponse.json({ error: out.error, reason: out.reason, detail: out.detail ?? null, version: out.version ?? null }, { status: out.status });
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
