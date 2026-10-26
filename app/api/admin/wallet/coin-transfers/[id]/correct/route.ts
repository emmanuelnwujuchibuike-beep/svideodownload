import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .discriminatedUnion("kind", [
    // the transfer's fee back to the sender, once per transfer (fee income reversed)
    z.object({ kind: z.literal("fee_refund"), reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }).strict(),
    // a platform-funded credit to the sender, never more than the transfer in total
    z.object({ kind: z.literal("sender_credit"), amountCents: z.number().int().positive().max(100_000_000), reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }).strict(),
  ]);

/**
 * POST /api/admin/wallet/coin-transfers/[id]/correct — correct a completed Frenz Coin transfer for a CONFIRMED error or
 * fraud (closeout, 0283 correct_coin_transfer). Administrators only, a fresh password, a reason, the transfer it
 * corrects, and a replay key (a double press is one correction; the key reused for something else is refused).
 * Only the SENDER is credited, from the platform; the recipient is never debited. Members cannot reverse a transfer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const gate = await requireFinancialAdmin("coin_transfer.correct", id);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the correction, give a reason and a request key." }, { status: 400 });
  const b = parsed.data;
  const { data, error } = await createAdminClient().rpc("correct_coin_transfer", { p_transfer: id, p_kind: b.kind, p_amount: b.kind === "sender_credit" ? b.amountCents : null, p_reason: b.reason, p_admin: gate.user.id, p_idempotency: b.idempotencyKey });
  const r = (data ?? {}) as { ok?: boolean; reason?: string; id?: string; amount?: number; duplicate?: boolean; remaining?: number };
  await auditAdminAction(gate.user.id, !error && r.ok ? "admin_coin_transfer_corrected" : "admin_coin_transfer_correction_refused", "coin_transfer.correct", id, { kind: b.kind, reason: error ? "error" : (r.reason ?? null) });
  if (error) return NextResponse.json({ error: /correct_coin_transfer|schema cache|does not exist/i.test(error.message) ? "Transfer corrections arrive with migration 0283." : "Couldn't record it. Nothing was changed." }, { status: 503 });
  if (r.ok) return NextResponse.json({ ok: true, id: r.id, amountCents: r.amount, duplicate: !!r.duplicate });
  const msg: Record<string, [number, string]> = {
    not_found: [404, "No transfer has that id."],
    no_fee: [409, "That transfer had no fee."],
    already_refunded: [409, "That transfer's fee was already refunded."],
    amount_out_of_range: [409, `Corrections can't add up to more than the transfer${r.remaining !== undefined ? ` ($${(Number(r.remaining) / 100).toFixed(2)} left)` : ""}.`],
    idempotency_conflict: [409, "That request key was already used for another correction."],
    invalid: [400, "That correction isn't valid."],
  };
  const [status, err] = msg[r.reason ?? ""] ?? [409, "Couldn't record it."];
  return NextResponse.json({ error: err, reason: r.reason }, { status });
}
