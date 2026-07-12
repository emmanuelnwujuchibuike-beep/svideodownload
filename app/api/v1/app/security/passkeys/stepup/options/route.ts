import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { passkeyLimiter } from "@/lib/rate-limit";
import { buildStepUpOptions } from "@/lib/security/webauthn";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({ purpose: z.string().min(1).max(40) });

/** POST /api/v1/app/security/passkeys/stepup/options — begin a step-up challenge for a given purpose (e.g. "settings", "recovery-regen"). */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await passkeyLimiter.limit(`passkey-stepup-options:${user.id}`);
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
  const { data: creds } = await db
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  if (!creds || creds.length === 0) return fail("not_found", "No passkeys enrolled.");

  const options = await buildStepUpOptions(creds.map((c) => ({ credential_id: c.credential_id, transports: c.transports })));

  await db.from("webauthn_challenges").delete().eq("user_id", user.id).eq("purpose", "stepup");
  await db.from("webauthn_challenges").insert({ user_id: user.id, challenge: options.challenge, purpose: "stepup" });

  return noStore(ok({ options }));
}
