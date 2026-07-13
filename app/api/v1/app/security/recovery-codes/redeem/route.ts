import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { clientId, recoveryCodeLimiter } from "@/lib/rate-limit";
import { sendPushToUser } from "@/lib/push/web-push";
import { hashRecoveryCode } from "@/lib/security/recovery-codes";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({ code: z.string().min(1).max(20) });

/**
 * POST /api/v1/app/security/recovery-codes/redeem — the ONLY job a
 * recovery code does: unstick an already-valid session's MFA gate by
 * removing the account's verified TOTP factor(s) via Supabase's own Admin
 * API (`auth.admin.mfa.deleteFactor`) — the same operation Supabase's own
 * dashboard "manage user" screen performs. This deliberately never mints a
 * session from scratch — the caller must already be signed in (any AAL);
 * see docs on why that constraint matters.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const ip = clientId(request.headers);
  const [byUser, byIp] = await Promise.all([
    recoveryCodeLimiter.limit(`recovery-redeem:user:${user.id}`),
    recoveryCodeLimiter.limit(`recovery-redeem:ip:${ip}`),
  ]);
  if (!byUser.success || !byIp.success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const db = createAdminClient();
  // Throws if RECOVERY_CODE_PEPPER isn't configured — degrade to the
  // standard error envelope instead of crashing with no response body.
  let codeHash: string;
  try {
    codeHash = hashRecoveryCode(parsed.data.code);
  } catch {
    return fail("internal");
  }

  const { data: row } = await db
    .from("mfa_recovery_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .maybeSingle();

  if (!row) {
    await writeAuditLog({ userId: user.id, eventType: "recovery_code_failed", request });
    // Generic message — no oracle on which failure mode (wrong code vs.
    // already used) this was.
    return noStore(ok({ ok: false }));
  }

  await db.from("mfa_recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);

  const { data: factorData } = await db.auth.admin.mfa.listFactors({ userId: user.id });
  const verifiedFactors = (factorData?.factors ?? []).filter((f) => f.status === "verified");
  await Promise.all(
    verifiedFactors.map((factor) => db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id }).catch(() => {})),
  );

  await db
    .from("account_security_settings")
    .update({ recovery_codes_remaining: 0 })
    .eq("user_id", user.id);

  await writeAuditLog({ userId: user.id, eventType: "recovery_code_used", request });
  await db.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_recovery_used" });
  after(() =>
    sendPushToUser(user.id, {
      title: "A recovery code was used on your account",
      body: "Two-factor authentication was turned off. Re-enroll a new authenticator if this wasn't you.",
      url: "/account/security",
      tag: "security-recovery-used",
    }),
  );

  return noStore(ok({ ok: true, mfaRemoved: verifiedFactors.length > 0 }));
}
