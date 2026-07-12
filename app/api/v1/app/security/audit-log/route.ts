import { getSessionUser } from "@/lib/api/authenticate";
import { clampLimit, decodeCursor, encodeCursor } from "@/lib/api/respond";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/** GET /api/v1/app/security/audit-log — the signed-in user's own recent security events ("Recent activity"). */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"), 20, 50);
  const offset = decodeCursor(searchParams.get("cursor"));

  const { data, error } = await createAdminClient()
    .from("security_audit_log")
    .select("id, event_type, user_agent, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return fail("internal");

  const rows = data ?? [];
  const nextCursor = rows.length === limit ? encodeCursor(offset + limit) : null;

  return noStore(
    ok(
      { events: rows.map((r) => ({ id: r.id, type: r.event_type, userAgent: r.user_agent, createdAt: r.created_at })) },
      { nextCursor },
    ),
  );
}
