import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { setRewardRestriction } from "@/lib/rewards/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email().max(320), restricted: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();

/**
 * POST /api/admin/rewards/restrict — flag (or clear) a member for reward fraud
 * (rewards brief §11, §14). While restricted: no new rewards, no qualification,
 * no withdrawal requests. Past rewards stay as they were — nothing is rewritten.
 *
 * Frenz Coin Part 4.1: this flag (reward_profiles.restricted) is the ACCOUNT-WIDE financial restriction — AI-credit
 * transfers and withdrawals, SUB withdrawals, affiliate payouts and Frenz Coin all honour it — and it is now set ONLY
 * here (0281: product shortfalls no longer write it). So it takes a fresh password (lib/admin/financial-gate.ts) and
 * writes a financial_audit_log row with the administrator, the member and the decision.
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("account_restriction.set", null);
  if (!gate.ok) return gate.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give an email and whether to restrict." }, { status: 400 });
  const { data } = await createAdminClient().from("profiles").select("id").ilike("email", parsed.data.email).maybeSingle();
  const userId = (data as { id?: string } | null)?.id;
  if (!userId) return NextResponse.json({ error: "No account with that email." }, { status: 404 });
  const ok = await setRewardRestriction(userId, parsed.data.restricted, parsed.data.reason ?? null, gate.user.id);
  await auditAdminAction(gate.user.id, ok ? (parsed.data.restricted ? "admin_account_restricted" : "admin_account_restriction_cleared") : "admin_account_restriction_failed", "account_restriction.set", userId, { restricted: parsed.data.restricted, reason: parsed.data.reason ?? null, scope: "account" });
  if (!ok) return NextResponse.json({ error: "Couldn't update it." }, { status: 503 });
  console.info("[admin/rewards] restriction", { admin: gate.user.id, userId, restricted: parsed.data.restricted });
  return NextResponse.json({ ok: true });
}
