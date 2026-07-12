import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { sendPushToUser } from "@/lib/push/web-push";
import { securityEventLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { hasValidStepUp } from "@/lib/security/stepup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({ factorId: z.string().min(1) });

/**
 * POST /api/v1/app/security/mfa/unenroll — server-side-enforced 2FA
 * disable. Unlike TOTP *enrollment* (which must stay a direct
 * `supabase.auth.mfa.*` client-SDK dance — the challenge/QR flow needs the
 * browser), disabling an existing factor doesn't need that, so it's routed
 * through OUR OWN backend instead of a bare client-side `mfa.unenroll()`
 * call — closing a real gap where the passkey step-up requirement was only
 * ever enforced in React, trivially bypassable by anyone with direct
 * Supabase-client access to the session (devtools, a stolen token replayed
 * against the SDK, etc).
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await securityEventLimiter.limit(`mfa-unenroll:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const db = createAdminClient();

  const { count: passkeyCount } = await db
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (passkeyCount && passkeyCount > 0 && !(await hasValidStepUp(user.id, "mfa-unenroll"))) {
    return fail("forbidden", "Verify with a passkey first.", { needsStepUp: true, purpose: "mfa-unenroll" });
  }

  const { data: factorData, error: listError } = await db.auth.admin.mfa.listFactors({ userId: user.id });
  if (listError) return fail("internal");
  const factor = factorData.factors.find((f) => f.id === parsed.data.factorId && f.status === "verified");
  if (!factor) return fail("not_found", "That factor isn't enrolled.");

  const { error: deleteError } = await db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
  if (deleteError) return fail("internal");

  await writeAuditLog({ userId: user.id, eventType: "mfa_unenrolled", request, metadata: { factorId: factor.id } });
  await db.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_2fa_disabled" });
  after(() =>
    sendPushToUser(user.id, {
      title: "Two-factor authentication turned off",
      body: "Your account no longer requires a second step to sign in.",
      url: "/account/security",
      tag: "security-2fa",
    }),
  );

  return noStore(ok({ ok: true }));
}
