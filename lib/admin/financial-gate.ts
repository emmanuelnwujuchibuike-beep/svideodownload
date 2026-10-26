import "server-only";

import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { hasRecentReauth } from "@/lib/admin/reauth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GATE FOR ADMIN ACTIONS THAT MOVE MONEY (Frenz Coin Part 2, M4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same two conditions as `requireSensitiveAdmin` (lib/admin/reauth.ts): a verified administrator AND a password
 * re-entered in the last ten minutes, checked on the server from the HttpOnly marker. The dashboard's
 * `sensitiveFetch` (features/admin/use-sensitive-action.tsx) answers `REAUTH_REQUIRED` with the password prompt and
 * replays the request once.
 *
 * Two differences, both deliberate:
 *   · a caller who is not an administrator gets the route's existing answer (403 "Forbidden"), so nothing that already
 *     worked against these routes changes shape;
 *   · a stale administrator is written to `financial_audit_log` (`admin_step_up_required`), and `auditAdminAction`
 *     records each action's outcome — success or refusal — with the administrator's id. Never a password, a token or a
 *     request body: only the action, its target and the outcome.
 */
export async function requireFinancialAdmin(action: string, targetId: string | null): Promise<{ ok: true; user: User } | { ok: false; response: Response }> {
  const user = await getAdminUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (!(await hasRecentReauth(user.id))) {
    await auditAdminAction(user.id, "admin_step_up_required", action, targetId, {});
    return { ok: false, response: NextResponse.json({ error: "Confirm your password to continue.", code: "REAUTH_REQUIRED" }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** One financial-audit row per admin money action. Best-effort: the action's own SQL writes its authoritative record. */
export async function auditAdminAction(actorId: string, auditAction: string, action: string, targetId: string | null, details: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("financial_audit_log")
      .insert({ actor_id: actorId, action: auditAction.slice(0, 80), target_type: "admin_action", target_id: targetId, reference: action.slice(0, 120), details });
    if (error) console.error("[admin/financial] audit write failed", { action, code: error.code });
  } catch {
    console.error("[admin/financial] audit write failed", { action });
  }
}
