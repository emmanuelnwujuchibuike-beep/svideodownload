import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { isCoinDepositReference, listCoinDepositReversals, recordAdminCoinDepositReversal } from "@/lib/coin/deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — Frenz Coin deposit refunds and chargebacks: disputes awaiting an outcome, open shortfalls, reviews, history. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const out = await listCoinDepositReversals(100);
  if (!out.ok) return NextResponse.json({ error: out.reason === "pending_migration" ? "Coin deposit reversals arrive with migration 0280." : "Couldn't load them." }, { status: 503 });
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z
  .object({
    reference: z.string().trim().max(80),
    kind: z.enum(["refund", "dispute"]),
    // a partial refund, in the charge's minor units: recorded for review, never applied by code. Omitted = the whole charge.
    refundedMinor: z.number().int().positive().max(10_000_000_000).optional(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

/**
 * POST — record a refund or chargeback of a Frenz Coin deposit, confirmed in the Flutterwave dashboard (Flutterwave has no
 * event contract here). The original charge is re-verified first; the replay key makes a double press one reversal.
 * SENSITIVE: a fresh password (lib/admin/financial-gate.ts).
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("coin_deposit_reversal.record", null);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the deposit reference, refund or dispute, and a reason." }, { status: 400 });
  if (!isCoinDepositReference(parsed.data.reference)) return NextResponse.json({ error: "That isn't a Frenz Coin deposit reference." }, { status: 400 });
  const out = await recordAdminCoinDepositReversal({ ...parsed.data, refundedMinor: parsed.data.refundedMinor ?? null, adminId: gate.user.id });
  await auditAdminAction(gate.user.id, out.ok ? "admin_coin_deposit_reversal_recorded" : "admin_coin_deposit_reversal_refused", "coin_deposit_reversal.record", parsed.data.reference, out.ok ? { id: out.id, state: out.state, shortfall: out.shortfall } : { reason: out.reason });
  if (out.ok) return NextResponse.json(out);
  const msg: Record<string, [number, string]> = {
    not_paid: [409, "Flutterwave doesn't show this deposit as paid, so nothing was taken back."],
    not_credited: [409, "No coins were ever added for this reference."],
    invalid: [400, "That amount is more than the charge."],
    pending_migration: [503, "Coin deposit reversals arrive with migration 0280."],
    error: [503, "Flutterwave or the database couldn't be reached. Nothing was changed. Try again."],
  };
  const [status, error] = msg[out.reason] ?? [409, "Couldn't record it."];
  return NextResponse.json({ error, reason: out.reason }, { status });
}
