import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { passkeyLimiter } from "@/lib/rate-limit";
import { buildRegistrationOptions } from "@/lib/security/webauthn";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** POST /api/v1/app/security/passkeys/register/options — begin enrollment. */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");
  if (!user.email) return fail("bad_request", "An email is required to register a passkey.");

  const { success } = await passkeyLimiter.limit(`passkey-register-options:${user.id}`);
  if (!success) return fail("rate_limited");

  const db = createAdminClient();
  const { data: existing } = await db
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  const options = await buildRegistrationOptions(
    user.id,
    user.email,
    (existing ?? []).map((c) => ({ credential_id: c.credential_id, transports: c.transports })),
  );

  await db.from("webauthn_challenges").delete().eq("user_id", user.id).eq("purpose", "registration");
  await db.from("webauthn_challenges").insert({ user_id: user.id, challenge: options.challenge, purpose: "registration" });

  return noStore(ok({ options }));
}
