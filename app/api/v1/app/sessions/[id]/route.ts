import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { cacheDelete } from "@/lib/cache";
import { writeAuditLog } from "@/lib/security/audit-log";
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

  // Trust survives a "sign this device out" — the user will likely sign
  // back in on the same physical device — only the stale session pointer
  // is cleared, never the trusted_devices row itself.
  await createAdminClient()
    .from("trusted_devices")
    .update({ current_session_id: null })
    .eq("user_id", user.id)
    .eq("current_session_id", id);

  await cacheDelete(`sessions:${user.id}`);
  await writeAuditLog({ userId: user.id, eventType: "session_revoked", request, metadata: { scope: "one", sessionId: id } });
  return noStore(ok({ revoked: true }));
}
