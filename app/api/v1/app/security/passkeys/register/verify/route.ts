import { after } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { passkeyLimiter } from "@/lib/rate-limit";
import { sendPushToUser } from "@/lib/push/web-push";
import { writeAuditLog } from "@/lib/security/audit-log";
import { toBytea } from "@/lib/security/bytea";
import { verifyRegistration } from "@/lib/security/webauthn";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  response: z.record(z.unknown()),
  label: z.string().trim().min(1).max(60).optional(),
});

/** POST /api/v1/app/security/passkeys/register/verify — finish enrollment. */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await passkeyLimiter.limit(`passkey-register-verify:${user.id}`);
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
  const { data: challengeRow } = await db
    .from("webauthn_challenges")
    .select("id, challenge, expires_at")
    .eq("user_id", user.id)
    .eq("purpose", "registration")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow || new Date(challengeRow.expires_at).getTime() < Date.now()) {
    return fail("bad_request", "That registration attempt expired. Try again.");
  }

  let verification;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verification = await verifyRegistration(parsed.data.response as any, challengeRow.challenge);
  } catch {
    return fail("bad_request", "Couldn't verify that passkey.");
  }

  await db.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  if (!verification.verified || !verification.registrationInfo) {
    return noStore(ok({ ok: false }));
  }

  const info = verification.registrationInfo;
  const { data: inserted, error } = await db
    .from("webauthn_credentials")
    .insert({
      user_id: user.id,
      credential_id: info.credential.id,
      public_key: toBytea(Buffer.from(info.credential.publicKey)),
      counter: info.credential.counter,
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
      transports: info.credential.transports ?? null,
      label: parsed.data.label || "Passkey",
    })
    .select("id, label")
    .single();
  if (error || !inserted) return fail("internal");

  await writeAuditLog({ userId: user.id, eventType: "passkey_enrolled", request, metadata: { credentialRowId: inserted.id } });
  await db.from("notifications").insert({ user_id: user.id, actor_id: null, type: "security_passkey_enrolled" });
  after(() =>
    sendPushToUser(user.id, {
      title: "A passkey was added to your account",
      body: `"${inserted.label}" can now be used to verify it's you for sensitive actions.`,
      url: "/account/security",
      tag: "security-passkey",
    }),
  );

  return noStore(ok({ ok: true, id: inserted.id, label: inserted.label }));
}
