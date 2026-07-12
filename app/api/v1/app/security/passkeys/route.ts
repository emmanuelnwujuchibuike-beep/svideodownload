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

/** GET /api/v1/app/security/passkeys — list enrolled passkeys. Explicit
 *  column select ONLY — public_key/counter must never reach the client. */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { data, error } = await createAdminClient()
    .from("webauthn_credentials")
    .select("id, label, device_type, backed_up, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return fail("internal");

  return noStore(
    ok({
      passkeys: (data ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        deviceType: p.device_type,
        backedUp: p.backed_up,
        createdAt: p.created_at,
        lastUsedAt: p.last_used_at,
      })),
    }),
  );
}
