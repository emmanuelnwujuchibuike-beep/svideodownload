import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { passkeyLimiter } from "@/lib/rate-limit";
import { sendPushToUser } from "@/lib/push/web-push";
import { writeAuditLog } from "@/lib/security/audit-log";
import { hasValidStepUp } from "@/lib/security/stepup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({ label: z.string().trim().min(1).max(60) });

/** PATCH /api/v1/app/security/passkeys/:id — rename. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await passkeyLimiter.limit(`passkey-patch:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const { data, error } = await createAdminClient()
    .from("webauthn_credentials")
    .update({ label: parsed.data.label })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, label")
    .maybeSingle();
  if (error) return fail("internal");
  if (!data) return fail("not_found");

  return noStore(ok({ passkey: data }));
}

/** DELETE /api/v1/app/security/passkeys/:id — remove a passkey. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await passkeyLimiter.limit(`passkey-delete:${user.id}`);
  if (!success) return fail("rate_limited");

  const db = createAdminClient();

  // Require a fresh step-up before removing ANY passkey — otherwise an
  // attacker with only session access (no biometric) could strip every
  // passkey off the account first, then sail through recovery-codes/generate
  // and MFA-unenroll's "only gated if passkeys > 0" checks unopposed.
  const { count: passkeyCount } = await db
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (passkeyCount && passkeyCount > 0 && !(await hasValidStepUp(user.id, "passkey-remove"))) {
    return fail("forbidden", "Verify with a passkey first.", { needsStepUp: true, purpose: "passkey-remove" });
  }

  const { data, error } = await db
    .from("webauthn_credentials")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, label")
    .maybeSingle();
  if (error) return fail("internal");
  if (!data) return fail("not_found");

  await writeAuditLog({ userId: user.id, eventType: "passkey_removed", request, metadata: { credentialRowId: id } });
  await db.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_passkey_removed" });
  after(() =>
    sendPushToUser(user.id, {
      title: "A passkey was removed from your account",
      body: `"${data.label}" can no longer be used to verify it's you.`,
      url: "/account/security",
      tag: "security-passkey",
    }),
  );

  return noStore(ok({ removed: true }));
}
