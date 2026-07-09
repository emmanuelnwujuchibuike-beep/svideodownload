import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { cacheDelete } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * DELETE /api/v1/app/sessions/:id — sign a single device out. Revoking the
 * device you're on now is allowed too; the caller (ActiveSessions UI) detects
 * that case and clears the local Supabase cookie + redirects itself, since
 * this route only touches the server-side session record.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { data, error } = await createAdminClient().rpc("revoke_user_session", {
    p_user_id: user.id,
    p_session_id: id,
  });
  if (error) return fail("internal");
  if (!data) return fail("not_found", "That session is already signed out.");

  await cacheDelete(`sessions:${user.id}`);
  return noStore(ok({ revoked: true }));
}
