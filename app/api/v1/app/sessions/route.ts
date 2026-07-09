import { bearer, getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { parseDevice } from "@/lib/auth/device-label";
import { decodeSessionId } from "@/lib/auth/session-jwt";
import { cacheDelete, getCached } from "@/lib/cache";
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

  const sessions = rows.map((row) => {
    const { label, icon } = parseDevice(row.user_agent);
    return {
      id: row.id,
      createdAt: row.created_at,
      lastActiveAt: row.updated_at ?? row.created_at,
      device: { label, icon },
      isCurrent: row.id === currentSessionId,
    };
  });

  return noStore(ok({ sessions }));
}

/** DELETE /api/v1/app/sessions — sign out every device except this one. */
export async function DELETE(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const token = await currentAccessToken(request);
  const currentSessionId = token ? decodeSessionId(token) : null;
  if (!currentSessionId) return fail("bad_request", "Couldn't identify this device's session.");

  const { data, error } = await createAdminClient().rpc("revoke_other_user_sessions", {
    p_user_id: user.id,
    p_keep_session_id: currentSessionId,
  });
  if (error) return fail("internal");

  await cacheDelete(cacheKey(user.id));
  return noStore(ok({ revoked: (data as number | null) ?? 0 }));
}
