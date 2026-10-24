import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { payWithdrawal } from "@/lib/rewards/flutterwave-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — approve (if needed) and pay one withdrawal through the admin's payout provider: Flutterwave by default with
 * Paystack as its backup, or Paystack (Admin → SUB → Payout provider). Idempotent per withdrawal and rail. The path keeps
 * its old name so existing links work.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const out = await payWithdrawal(id, admin.id);
  console.info("[admin/rewards] payout", { admin: admin.id, id, ok: out.ok, provider: out.ok ? out.provider : null });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: 409 });
}
