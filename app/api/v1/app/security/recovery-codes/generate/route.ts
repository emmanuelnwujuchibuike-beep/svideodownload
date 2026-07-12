import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { recoveryCodeLimiter } from "@/lib/rate-limit";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/security/recovery-codes";
import { writeAuditLog } from "@/lib/security/audit-log";
import { hasValidStepUp } from "@/lib/security/stepup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * POST /api/v1/app/security/recovery-codes/generate — issues a fresh set of
 * 10 recovery codes, invalidating any previously-issued unused ones.
 * Plaintext codes are returned exactly once — never retrievable again
 * (only hashes are stored) — the UI must force an explicit
 * "I've saved these" acknowledgment before letting the user dismiss them.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await recoveryCodeLimiter.limit(`recovery-generate:${user.id}`);
  if (!success) return fail("rate_limited");

  const db = createAdminClient();

  // If the account has ANY passkey enrolled, regenerating recovery codes
  // requires a fresh passkey step-up first — accounts with zero passkeys
  // are completely unaffected (opt-in hardening, not new mandatory friction).
  const { count: passkeyCount } = await db
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (passkeyCount && passkeyCount > 0 && !(await hasValidStepUp(user.id, "recovery-regen"))) {
    return fail("forbidden", "Verify with a passkey first.", { needsStepUp: true, purpose: "recovery-regen" });
  }

  const codes = generateRecoveryCodes(10);

  await db.from("mfa_recovery_codes").delete().eq("user_id", user.id).is("used_at", null);
  const { error } = await db
    .from("mfa_recovery_codes")
    .insert(codes.map((code) => ({ user_id: user.id, code_hash: hashRecoveryCode(code) })));
  if (error) return fail("internal");

  const now = new Date().toISOString();
  await db.from("account_security_settings").upsert(
    { user_id: user.id, recovery_codes_generated_at: now, recovery_codes_remaining: codes.length, updated_at: now },
    { onConflict: "user_id" },
  );

  await writeAuditLog({ userId: user.id, eventType: "recovery_codes_generated", request });
  return noStore(ok({ codes }));
}
