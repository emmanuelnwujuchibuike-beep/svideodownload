import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { securityEventLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({ factorId: z.string().min(1) });

/**
 * POST /api/v1/app/security/mfa-event — audit-log + notification hook for
 * TOTP enrollment, which happens entirely client-side via `supabase.auth.
 * mfa.enroll/verify` (the QR/challenge dance needs the browser) and never
 * otherwise touches our backend. The client's claim is NEVER trusted
 * blindly: this re-verifies the factor is really verified via the admin MFA
 * API before writing anything. Disabling 2FA is NOT handled here — see
 * `/api/v1/app/security/mfa/unenroll`, which performs the unenroll itself
 * server-side (with a real, enforced passkey step-up gate) rather than just
 * logging a client-side `mfa.unenroll()` call after the fact.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await securityEventLimiter.limit(`mfa-event:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (error) return fail("internal");

  const hasVerifiedFactor = data.factors.some((f) => f.id === parsed.data.factorId && f.status === "verified");
  if (!hasVerifiedFactor) return fail("bad_request", "That factor isn't verified yet.");

  await writeAuditLog({ userId: user.id, eventType: "mfa_enrolled", request, metadata: { factorId: parsed.data.factorId } });
  await admin.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_2fa" });
  after(() =>
    sendPushToUser(user.id, {
      title: "Two-factor authentication enabled",
      body: "Your account now requires a code from your authenticator app to sign in.",
      url: "/account/security",
      tag: "security-2fa",
    }),
  );

  return noStore(ok({ ok: true }));
}
