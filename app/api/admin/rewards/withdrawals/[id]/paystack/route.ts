import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { payWithdrawalViaPaystack } from "@/lib/rewards/paystack-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — approve (if needed) and pay one withdrawal through Paystack Transfers. Idempotent per withdrawal. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const out = await payWithdrawalViaPaystack(id, admin.id);
  console.info("[admin/rewards] paystack payout", { admin: admin.id, id, ok: out.ok });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: 409 });
}
