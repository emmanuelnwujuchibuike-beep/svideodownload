import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { resolveWithdrawal } from "@/lib/rewards/withdrawals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["reviewing", "approved", "processing", "completed", "rejected", "cancelled"]), note: z.string().trim().max(500).optional(), payoutReference: z.string().trim().max(120).optional() }).strict();

/**
 * POST /api/admin/rewards/withdrawals/[id] — move a withdrawal (manual payout,
 * owner 2026-10-07). The database allows only the legal moves and returns the
 * credits on a rejection or cancellation, once (resolve_withdrawal). "completed"
 * is the admin's statement that they PAID it — record the payout reference.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (parsed.data.status === "completed" && !parsed.data.payoutReference) return NextResponse.json({ error: "Record the payout reference (the bank transfer id) before marking it paid." }, { status: 400 });
  const out = await resolveWithdrawal({ id, status: parsed.data.status, adminId: admin.id, note: parsed.data.note ?? null, payoutReference: parsed.data.payoutReference ?? null });
  if (!out.ok) return NextResponse.json({ error: out.reason === "invalid_transition" ? "That move isn't allowed from its current state." : out.reason === "final" ? "This withdrawal is already finished." : "Couldn't update it." }, { status: 409 });
  console.info("[admin/rewards] withdrawal moved", { admin: admin.id, id, to: parsed.data.status });
  return NextResponse.json({ ok: true });
}
