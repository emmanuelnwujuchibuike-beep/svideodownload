import { after } from "next/server";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { sendPushToUser } from "@/lib/push/web-push";
import { securityEventLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * POST /api/v1/app/security/password-changed — audit-log + notification
 * hook for `password-editor.tsx`'s direct `supabase.auth.updateUser
 * ({password})` call, which otherwise never touches our backend (same
 * pattern as mfa-event for enrollment). A client-asserted signal, like
 * device-check's own — there's nothing server-side to independently verify
 * here (the password itself is never visible to us), so this is a
 * best-effort record, not a re-verified one.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await securityEventLimiter.limit(`password-changed:${user.id}`);
  if (!success) return fail("rate_limited");

  await writeAuditLog({ userId: user.id, eventType: "password_changed", request });

  const admin = createAdminClient();
  await admin.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_password" });
  after(() =>
    sendPushToUser(user.id, {
      title: "Your password was changed",
      body: "If this wasn't you, review your active sessions and secure your account.",
      url: "/account/security#sessions",
      tag: "security-password",
    }),
  );

  return noStore(ok({ ok: true }));
}
