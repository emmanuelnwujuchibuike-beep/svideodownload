import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/app/security/pin/status — whether a PIN is set + the configured auto-lock window. Never returns the hash. */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { data } = await createAdminClient()
    .from("security_pin")
    .select("auto_lock_minutes, pin_length")
    .eq("user_id", user.id)
    .maybeSingle();

  return noStore(
    ok({ hasPin: !!data, autoLockMinutes: data?.auto_lock_minutes ?? 5, pinLength: data?.pin_length ?? 4 }),
  );
}
