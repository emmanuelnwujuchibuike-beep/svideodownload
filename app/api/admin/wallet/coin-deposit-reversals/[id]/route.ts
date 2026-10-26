import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { applyCoinDepositPartialRefund, clearCoinDepositShortfall, resolveCoinDepositDispute } from "@/lib/coin/deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  // a dispute's outcome, as the Flutterwave dashboard shows it
  z.object({ action: z.literal("resolve"), outcome: z.enum(["won", "lost"]), note: z.string().trim().min(3).max(500) }).strict(),
  // a shortfall recovered from the member, or written off
  z.object({ action: z.literal("clear"), note: z.string().trim().min(3).max(500) }).strict(),
  // closeout (0283): apply a partial refund held for review — its share only, once, after the hold
  z.object({ action: z.literal("apply_partial"), note: z.string().trim().min(3).max(500) }).strict(),
]);

/** POST — resolve a coin deposit dispute, or settle a shortfall. Once only, audited. SENSITIVE: a fresh password. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const gate = await requireFinancialAdmin("coin_deposit_reversal.update", id);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose what to record and give a reason." }, { status: 400 });
  const out =
    parsed.data.action === "resolve"
      ? await resolveCoinDepositDispute(id, parsed.data.outcome, gate.user.id, parsed.data.note)
      : parsed.data.action === "apply_partial"
        ? await applyCoinDepositPartialRefund(id, gate.user.id, parsed.data.note)
        : await clearCoinDepositShortfall(id, gate.user.id, parsed.data.note);
  await auditAdminAction(gate.user.id, out.ok ? "admin_coin_deposit_reversal_updated" : "admin_coin_deposit_reversal_update_refused", `coin_deposit_reversal.${parsed.data.action}`, id, { reason: out.reason ?? null });
  if (out.ok) return NextResponse.json(out);
  const msg: Record<string, string> = { not_found: "Not found.", not_a_dispute: "Only a dispute has an outcome.", no_shortfall: "This reversal left no shortfall.", not_a_partial_refund: "Only a partial refund in review can be applied.", deposit_on_hold: "That deposit is still on hold. Apply the partial refund once it is released.", pending_migration: "Coin deposit reversals arrive with migration 0280." };
  return NextResponse.json({ error: msg[out.reason ?? ""] ?? "Couldn't update it.", reason: out.reason }, { status: out.reason === "pending_migration" ? 503 : 409 });
}
