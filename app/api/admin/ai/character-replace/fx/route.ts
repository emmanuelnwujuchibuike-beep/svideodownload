import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { getLandingSettings } from "@/lib/landing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The checkout rate as the initializer would resolve it right now (2026-09-20),
 * for the admin Recharge group's readout: the market rate, its source and
 * age, the markup, and the minor units per $1 a member is charged at. Read
 * only; one fetch when the panel opens, never a poll.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = await getLandingSettings();
  const cr = settings.frenzAiCharacterReplace;
  const rate = await resolveCheckoutRate(cr, settings.frenzAiCurrency);
  return NextResponse.json(
    {
      wallet: settings.frenzAiCurrency,
      checkout: cr.recharge.checkoutCurrency,
      applies: rate !== null,
      rate: rate && !("error" in rate) ? rate : null,
      missing: !!rate && "error" in rate,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
