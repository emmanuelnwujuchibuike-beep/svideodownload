import { bearer, getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { decodeSessionId } from "@/lib/auth/session-jwt";
import { mergeSessionsWithDevices } from "@/lib/auth/devices";
import { cacheDelete, getCached } from "@/lib/cache";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  user_agent: string | null;
}

const cacheKey = (userId: string) => `sessions:${userId}`;

/** The access token for THIS request, used only to identify "this device". */
async function currentAccessToken(request: Request): Promise<string | null> {
  const token = bearer(request);
  if (token) return token;
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * GET /api/v1/app/sessions — the signed-in user's active devices, sourced
 * from Supabase Auth's own `auth.sessions` table (see migration 0034) so
 * this reflects real, revocable sessions rather than a shadow tracker.
 * List is Redis-cached briefly (see [[lib/cache.ts]]); "this device" is
 * computed fresh per-request from the caller's own token, never cached.
 */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const rows = await getCached(cacheKey(user.id), 20, async () => {
    const { data, error } = await createAdminClient().rpc("list_user_sessions", { p_user_id: user.id });
    if (error) throw error;
    return (data ?? []) as SessionRow[];
  });

  const token = await currentAccessToken(request);
  const currentSessionId = token ? decodeSessionId(token) : null;

  // Left-joins in device naming/trust (migration 0054) — see
  // lib/auth/devices.ts for why this can't be a SQL join.
  const sessions = await mergeSessionsWithDevices(user.id, rows, currentSessionId);

  return noStore(ok({ sessions }));
}

/** DELETE /api/v1/app/sessions — sign out every device except this one. */
export async function DELETE(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const token = await currentAccessToken(request);
  const currentSessionId = token ? decodeSessionId(token) : null;
  if (!currentSessionId) return fail("bad_request", "Couldn't identify this device's session.");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("revoke_other_user_sessions", {
    p_user_id: user.id,
    p_keep_session_id: currentSessionId,
  });
  if (error) return fail("internal");

  // Matches the single-session DELETE route: trust survives a "sign out
  // other devices," only the now-stale session pointer is cleared.
  await admin
    .from("trusted_devices")
    .update({ current_session_id: null })
    .eq("user_id", user.id)
    .neq("current_session_id", currentSessionId);

  await cacheDelete(cacheKey(user.id));
  await writeAuditLog({
    userId: user.id,
    eventType: "session_revoked",
    request,
    metadata: { scope: "others", count: (data as number | null) ?? 0 },
  });
  return noStore(ok({ revoked: (data as number | null) ?? 0 }));
}
