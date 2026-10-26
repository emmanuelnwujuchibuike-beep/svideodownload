import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { listTopupReversals, recordAdminTopupReversal, topupProvider } from "@/lib/ai/wallet/topup-reversals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the wallet top-up refunds and chargebacks: held disputes, open shortfalls, recent history. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const out = await listTopupReversals(100);
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z
  .object({
    reference: z.string().trim().max(80),
    kind: z.enum(["refund", "dispute"]),
    // a partial refund, in the charge's minor units; omitted = the whole charge
    refundedMinor: z.number().int().positive().max(10_000_000_000).optional(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

/**
 * POST — record a refund or chargeback confirmed in the provider's dashboard (Flutterwave has no event contract here;
 * a Paystack one the webhook could not take). The original charge is re-verified with its provider first; the replay
 * key makes a double press one reversal. SENSITIVE: a fresh password (lib/admin/financial-gate.ts).
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("topup_reversal.record", null);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the top-up reference, refund or dispute, and a reason." }, { status: 400 });
  if (!topupProvider(parsed.data.reference)) return NextResponse.json({ error: "That isn't a wallet top-up reference." }, { status: 400 });
  const out = await recordAdminTopupReversal({ ...parsed.data, refundedMinor: parsed.data.refundedMinor ?? null, adminId: gate.user.id });
  await auditAdminAction(gate.user.id, out.ok ? "admin_topup_reversal_recorded" : "admin_topup_reversal_refused", "topup_reversal.record", parsed.data.reference, out.ok ? { id: out.id, state: out.state, shortfall: out.shortfall } : { reason: out.reason });
  if (out.ok) return NextResponse.json(out);
  const msg: Record<string, [number, string]> = {
    not_paid: [409, "The provider doesn't show this top-up as paid, so nothing was taken back."],
    not_credited: [409, "No credits were ever added for this reference."],
    invalid: [400, "That amount is more than the charge."],
    pending_migration: [503, "Top-up reversals arrive with migration 0278."],
    error: [503, "The provider or the database couldn't be reached. Nothing was changed. Try again."],
    currency: [409, "That refund is in another currency."],
  };
  const [status, error] = msg[out.reason] ?? [409, "Couldn't record it."];
  return NextResponse.json({ error, reason: out.reason }, { status });
}
