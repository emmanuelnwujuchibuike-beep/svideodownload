import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { creditAiBalance } from "@/lib/ai/balance";
import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/ai/credit — put AI balance on a member's account
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §14: "Add an admin capability to manually
 * credit a user's AI balance… Manual credits must create an immutable ledger
 * record… Do not simply modify a numeric balance without recording the
 * transaction."
 *
 * ── 🔴 IT CANNOT MODIFY A BALANCE, ONLY APPEND TO A LEDGER ──────────────────
 *
 * This route issues no UPDATE. It calls `credit_ai_balance`, which writes the
 * ledger row and the balance in one transaction — so a credit that happened is
 * always a credit that is recorded, and there is no code path that produces one
 * without the other. The route could not "just set the balance" if somebody
 * wanted it to.
 *
 * Recorded on every credit: who received it, how much, that it was an admin
 * credit, WHICH admin, the note they gave, the resulting balance and a
 * reference. That is §14's list, and none of it is optional.
 *
 * ── 🔴 A REASON IS REQUIRED, AND THAT IS NOT BUREAUCRACY ────────────────────
 *
 * This is the one door in the product through which money appears from nowhere.
 * A ledger full of unexplained credits is indistinguishable from a compromised
 * admin account, which is exactly the situation the ledger exists to make
 * visible. The note is never shown to the member.
 *
 * ── The member is found by EMAIL, and confirmed back ────────────────────────
 *
 * An operator types an address; the response says whose balance changed and
 * what it became. Taking a user id would be faster and would make crediting the
 * wrong person a silent, unrecoverable typo.
 */
const schema = z.object({
  email: z.string().trim().email().max(320),
  /**
   * 🔴 MINOR UNITS, integer, like every amount in this system. Capped at
   * 1,000,000 (= $10,000): a manual credit is a goodwill gesture or a support
   * fix, and a slipped digit on an uncapped field is a five-figure liability
   * created by one keystroke.
   */
  amountCents: z.coerce.number().int().min(1).max(1_000_000),
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
    return NextResponse.json(
      { error: "Give an email, an amount in cents, and a reason." },
      { status: 400 },
    );
  }
  const { email, amountCents, note } = parsed.data;

  const { frenzAiCurrency } = await getLandingSettings();
  const symbol = aiCurrencySymbol(frenzAiCurrency);

  const db = createAdminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    console.error("[admin/ai-credit] lookup failed", { message: error.message });
    return NextResponse.json({ error: "Couldn't look that account up." }, { status: 500 });
  }
  if (!profile?.id) {
    // 🔴 Says so plainly. This is an admin screen — there is no account to
    // enumerate that the operator cannot already list — so the vague "if an
    // account exists…" wording that protects a public form would only make a
    // typo harder to notice here.
    return NextResponse.json({ error: "No account with that email." }, { status: 404 });
  }

  try {
    /*
      🔴 A FRESH REFERENCE PER REQUEST, and that is correct HERE where it would
      be wrong for a webhook. The idempotency key exists to collapse repeated
      deliveries of ONE event; an admin pressing the button twice means two
      credits, deliberately. Making them collide would silently swallow the
      second, which is a worse failure than an extra ledger row an operator can
      see and reverse.
    */
    const balance = await creditAiBalance({
      userId: profile.id as string,
      amountCents,
      kind: "admin_credit",
      reference: `admin_${randomUUID()}`,
      note,
      adminId: admin.id,
    });

    console.info("[admin/ai-credit] credited", {
      admin: admin.id,
      user: profile.id,
      amountCents,
    });

    return NextResponse.json({
      ok: true,
      email: profile.email,
      creditedCents: amountCents,
      balanceCents: balance,
      // Rendered for the operator, so they can see what they actually granted
      // before deciding whether it was what they meant.
      // 🔴 The CONFIGURED symbol, not a hardcoded "$". An operator on a naira
      // account reading "$10.00" after granting ₦10.00 would be told the
      // opposite of what happened, by a factor of about 1,500.
      credited: formatCents(amountCents, symbol),
      balance: formatCents(balance, symbol),
    });
  } catch (e) {
    console.error("[admin/ai-credit] credit failed", { user: profile.id, error: String(e) });
    return NextResponse.json({ error: "The credit didn't go through." }, { status: 500 });
  }
}
