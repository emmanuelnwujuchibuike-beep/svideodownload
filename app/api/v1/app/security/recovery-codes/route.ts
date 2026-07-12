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

/** GET /api/v1/app/security/recovery-codes — counts remaining, never the codes themselves. */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { data } = await createAdminClient()
    .from("account_security_settings")
    .select("recovery_codes_remaining, recovery_codes_generated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return noStore(
    ok({
      remaining: data?.recovery_codes_remaining ?? 0,
      generatedAt: data?.recovery_codes_generated_at ?? null,
    }),
  );
}
