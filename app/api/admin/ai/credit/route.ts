import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { adjustCharacterReplaceBalance } from "@/lib/ai/character-replace/wallet";
import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/ai/credit — put Frenz AI balance on a member's account
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 ONE WALLET (owner, 2026-09-14; migration 0155) ────────────────────────
 *
 * This used to write `ai_balances` (`creditAiBalance`, kind `admin_credit`).
 * That wallet is retired — every balance moved into the Character Replace
 * product wallet, which is now THE Frenz AI balance — so a credit here lands
 * where /api/admin/ai/character-replace/adjust lands: one `adjustment` row on
 * `ai_product_ledger` carrying the operator's id and reason. Kept at its old
 * address for any operator tooling that calls it.
 *
 * A FRESH REFERENCE PER REQUEST, deliberately: an admin pressing twice means
 * two credits, both visible, both reversible. Collapsing them would hide the
 * second. (The admin FORM guards the double-press on its side.)
 */
const schema = z.object({
  email: z.string().trim().email().max(320),
  amountCents: z.coerce.number().int().min(1).max(100_000_000),
  note: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Give an email, an amount in cents, and a reason." }, { status: 400 });
  }
  const { email, amountCents, note } = parsed.data;

  const { frenzAiCurrency } = await getLandingSettings();
  const symbol = aiCurrencySymbol(frenzAiCurrency);

  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles").select("id, email").ilike("email", email).maybeSingle();
  if (error) {
    console.error("[admin/ai-credit] lookup failed", { message: error.message });
    return NextResponse.json({ error: "Couldn't look that account up." }, { status: 500 });
  }
  if (!profile?.id) {
    // Plainly: this is an admin screen, and a vague answer only hides a typo.
    return NextResponse.json({ error: "No account with that email." }, { status: 404 });
  }

  try {
    const balance = await adjustCharacterReplaceBalance({
      userId: profile.id as string,
      deltaCents: amountCents,
      reference: `admin_${randomUUID()}`,
      note,
      adminId: admin.id,
      currency: frenzAiCurrency,
    });
    console.info("[admin/ai-credit] credited", { admin: admin.id, user: profile.id, amountCents });
    return NextResponse.json({
      ok: true,
      email: profile.email,
      creditedCents: amountCents,
      balanceCents: balance,
      credited: formatCents(amountCents, symbol),
      balance: formatCents(balance, symbol),
    });
  } catch (e) {
    console.error("[admin/ai-credit] failed", { admin: admin.id, user: profile.id, error: String(e) });
    return NextResponse.json({ error: "The credit didn't apply. Nothing was changed." }, { status: 500 });
  }
}
