import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { readGiftSettings, saveGiftConversion } from "@/lib/gift/settings-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// whole numbers only: the bounds are checkConversionRules' (and the database's), which name the field when one is off
const leg = z
  .object({
    rateNum: z.number().int(),
    rateDen: z.number().int(),
    feeBp: z.number().int(),
    feeFlat: z.number().int(),
    minIn: z.number().int(),
    maxIn: z.number().int(),
    dailyMaxIn: z.number().int(),
  })
  .strict();
const schema = z
  .object({
    fcToFgc: leg,
    fgcToFc: leg,
    // the version the administrator was editing (0 = nothing configured yet). The server stamps the next one.
    expectedVersion: z.number().int().min(0),
  })
  .strict();

/** GET /api/admin/gift/settings — the stored Frenz Gift Coin conversion rules (or "not configured"), with the round-trip summary. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = await readGiftSettings();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ settings: r.settings, summary: r.summary }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/admin/gift/settings — save the conversion rules (Frenz Gift Coin Part 3, 0291). A money setting: a verified
 * administrator with a fresh password (requireFinancialAdmin). Validated with checkConversionRules here and again in
 * the database; refused with the reason, never adjusted. A stale version is refused (409). The version bumps only
 * when a leg changed. Audited in the same transaction as the save; a refused attempt is audited too.
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("gift.settings", "frenzGift");
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ");
    return NextResponse.json({ error: fields ? `Couldn't save — ${fields}` : "Invalid request.", reason: "invalid" }, { status: 400 });
  }
  const { expectedVersion, ...legs } = parsed.data;
  const out = await saveGiftConversion({ adminId: gate.user.id, legs, expectedVersion });
  if (!out.ok) {
    // the app's own refusal never reached the database: record its outcome here (no secrets, the rules only)
    if (out.reason === "invalid") await auditAdminAction(gate.user.id, "gift_conversion_config_rejected", "gift.settings", "frenzGift", { detail: out.detail ?? null, expectedVersion, attempted: legs });
    return NextResponse.json({ error: out.error, reason: out.reason, detail: out.detail ?? null, version: out.version ?? null }, { status: out.status });
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
