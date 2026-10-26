import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { clearTopupShortfall, resolveTopupDispute } from "@/lib/ai/wallet/topup-reversals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  // a dispute's outcome, as the provider's dashboard shows it
  z.object({ action: z.literal("resolve"), outcome: z.enum(["won", "lost"]), note: z.string().trim().min(3).max(500) }).strict(),
  // a shortfall recovered from the member, or written off
  z.object({ action: z.literal("clear"), note: z.string().trim().min(3).max(500) }).strict(),
]);

/** POST — resolve a held dispute, or settle a shortfall. Once only, audited. SENSITIVE: a fresh password. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const gate = await requireFinancialAdmin("topup_reversal.update", id);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose what to record and give a reason." }, { status: 400 });
  const out = parsed.data.action === "resolve" ? await resolveTopupDispute(id, parsed.data.outcome, gate.user.id, parsed.data.note) : await clearTopupShortfall(id, gate.user.id, parsed.data.note);
  await auditAdminAction(gate.user.id, out.ok ? "admin_topup_reversal_updated" : "admin_topup_reversal_update_refused", `topup_reversal.${parsed.data.action}`, id, { reason: out.reason ?? null });
  if (out.ok) return NextResponse.json(out);
  const msg: Record<string, string> = { not_found: "Not found.", not_a_dispute: "Only a dispute has an outcome.", no_shortfall: "This reversal left no shortfall.", pending_migration: "Top-up reversals arrive with migration 0278." };
  return NextResponse.json({ error: msg[out.reason ?? ""] ?? "Couldn't update it.", reason: out.reason }, { status: out.reason === "pending_migration" ? 503 : 409 });
}
