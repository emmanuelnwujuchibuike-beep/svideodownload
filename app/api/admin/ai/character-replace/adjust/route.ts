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
 *  POST /api/admin/ai/character-replace/adjust — move a member's CR balance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 3, §22: "Admin manual balance adjustment (credit/debit with reason)".
 * The mirror of /api/admin/ai/credit for the PRODUCT wallet: an operator, an
 * email, a signed amount, a reason. A positive amount credits, a negative
 * one debits; the database function (`adjust_product_balance`, 0154) writes
 * one `adjustment` row carrying the operator's id and refuses a debit that
 * would take the balance below zero — the balance is never negative, and
 * this route says so in a sentence instead of a stack.
 *
 * 🔴 Never `ai_balances`. Nothing here can reach the AI wallet.
 *
 * A FRESH REFERENCE PER REQUEST, on purpose (see the AI credit route): an
 * operator pressing twice means two adjustments, both visible, both
 * reversible. Collapsing them would hide the second.
 */
const schema = z
  .object({
    email: z.string().trim().email().max(320),
    amountCents: z.coerce.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, "zero"),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

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
    return NextResponse.json({ error: "Give an email, a non-zero amount in cents, and a reason." }, { status: 400 });
  }
  const { email, amountCents, note } = parsed.data;

  const { frenzAiCurrency } = await getLandingSettings();
  const symbol = aiCurrencySymbol(frenzAiCurrency);

  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles").select("id, email").ilike("email", email).maybeSingle();
  if (error) {
    console.error("[admin/cr-adjust] lookup failed", { message: error.message });
    return NextResponse.json({ error: "Couldn't look that account up." }, { status: 500 });
  }
  if (!profile?.id) {
    // Plainly, as the AI credit route does: this is an admin screen.
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
    console.info("[admin/cr-adjust] applied", { admin: admin.id, user: profile.id, amountCents });
    return NextResponse.json({
      ok: true,
      email: profile.email,
      deltaCents: amountCents,
      balanceCents: balance,
      delta: formatCents(amountCents, symbol),
      balance: formatCents(balance, symbol),
    });
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if (/insufficient/i.test(message)) {
      return NextResponse.json({ error: "That debit is more than their Character Replace balance. The balance can't go below zero." }, { status: 409 });
    }
    console.error("[admin/cr-adjust] failed", { admin: admin.id, user: profile.id, error: message });
    return NextResponse.json({ error: "The adjustment didn't apply. Nothing was changed." }, { status: 500 });
  }
}
