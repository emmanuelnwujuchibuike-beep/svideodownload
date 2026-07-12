import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { securityEventLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  requirePasskeyForSettings: z.boolean().optional(),
  requireStepupOnNewDevice: z.boolean().optional(),
});

/** GET /api/v1/app/security/settings */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { data } = await createAdminClient()
    .from("account_security_settings")
    .select("require_passkey_for_settings, require_stepup_on_new_device")
    .eq("user_id", user.id)
    .maybeSingle();

  return noStore(
    ok({
      requirePasskeyForSettings: data?.require_passkey_for_settings ?? false,
      requireStepupOnNewDevice: data?.require_stepup_on_new_device ?? false,
    }),
  );
}

/**
 * PATCH /api/v1/app/security/settings — `requireStepupOnNewDevice` defaults
 * OFF and stays owner opt-in: forcing a passkey step-up on every
 * untrusted-device login would make WebAuthn a semi-mandatory second
 * factor, a bigger product decision than this round makes unilaterally.
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await securityEventLimiter.limit(`security-settings:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if (parsed.data.requirePasskeyForSettings !== undefined) patch.require_passkey_for_settings = parsed.data.requirePasskeyForSettings;
  if (parsed.data.requireStepupOnNewDevice !== undefined) patch.require_stepup_on_new_device = parsed.data.requireStepupOnNewDevice;

  const { error } = await createAdminClient().from("account_security_settings").upsert(patch, { onConflict: "user_id" });
  if (error) return fail("internal");

  return noStore(ok({ ok: true }));
}
