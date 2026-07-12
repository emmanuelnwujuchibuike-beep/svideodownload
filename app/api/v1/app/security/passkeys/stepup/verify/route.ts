import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { passkeyLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { fromBytea } from "@/lib/security/bytea";
import { issueStepUp } from "@/lib/security/stepup";
import { counterLooksReplayed, verifyStepUp } from "@/lib/security/webauthn";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  response: z.object({ id: z.string() }).passthrough(),
  purpose: z.string().min(1).max(40),
});

/** POST /api/v1/app/security/passkeys/stepup/verify — clears a step-up challenge, issuing a 5-minute signed cookie scoped to `purpose`. */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await passkeyLimiter.limit(`passkey-stepup-verify:${user.id}`);
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
  const { data: credRow } = await db
    .from("webauthn_credentials")
    .select("id, credential_id, public_key, counter, transports")
    .eq("user_id", user.id)
    .eq("credential_id", parsed.data.response.id)
    .maybeSingle();

  if (!credRow) {
    await writeAuditLog({ userId: user.id, eventType: "stepup_failed", request, metadata: { reason: "unknown_credential" } });
    return noStore(ok({ ok: false }));
  }

  const { data: challengeRow } = await db
    .from("webauthn_challenges")
    .select("id, challenge, expires_at")
    .eq("user_id", user.id)
    .eq("purpose", "stepup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow || new Date(challengeRow.expires_at).getTime() < Date.now()) {
    return fail("bad_request", "That challenge expired. Try again.");
  }

  let verification;
  try {
    verification = await verifyStepUp(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.data.response as any,
      challengeRow.challenge,
      {
        credential_id: credRow.credential_id,
        public_key: fromBytea(credRow.public_key),
        counter: credRow.counter,
        transports: credRow.transports,
      },
    );
  } catch {
    await writeAuditLog({ userId: user.id, eventType: "stepup_failed", request });
    return noStore(ok({ ok: false }));
  }

  await db.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  const newCounter = verification.authenticationInfo.newCounter;
  if (!verification.verified || counterLooksReplayed(credRow.counter, newCounter)) {
    await writeAuditLog({ userId: user.id, eventType: "stepup_failed", request, metadata: { reason: "replay_or_unverified" } });
    return noStore(ok({ ok: false }));
  }

  await db
    .from("webauthn_credentials")
    .update({ counter: newCounter, last_used_at: new Date().toISOString() })
    .eq("id", credRow.id);

  await issueStepUp(user.id, parsed.data.purpose);
  await writeAuditLog({ userId: user.id, eventType: "stepup_verified", request, metadata: { purpose: parsed.data.purpose } });

  return noStore(ok({ ok: true }));
}
