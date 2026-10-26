import { NextResponse } from "next/server";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { payWithdrawal } from "@/lib/rewards/flutterwave-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — approve (if needed) and pay one withdrawal through the admin's payout provider: Flutterwave by default with
 * Paystack as its backup, or Paystack (Admin → SUB → Payout provider). Idempotent per withdrawal and rail. The path keeps
 * its old name so existing links work.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  // SENSITIVE (Frenz Coin Part 2, M4): this sends money to a bank account — a fresh password on top of the session
  const gate = await requireFinancialAdmin("withdrawal.pay", id);
  if (!gate.ok) return gate.response;
  const admin = gate.user;
  const out = await payWithdrawal(id, admin.id);
  console.info("[admin/rewards] payout", { admin: admin.id, id, ok: out.ok, provider: out.ok ? out.provider : null });
  await auditAdminAction(admin.id, out.ok ? "admin_withdrawal_paid" : "admin_withdrawal_pay_refused", "withdrawal.pay", id, out.ok ? { provider: out.provider, status: out.status } : { error: out.error.slice(0, 160) });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: 409 });
}
