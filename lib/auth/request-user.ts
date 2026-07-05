import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the authenticated user for an API route from EITHER an
 * `Authorization: Bearer <supabase access token>` header (native / desktop
 * clients, which have no cookies) OR the cookie session (web). This is what lets
 * one backend serve every platform through the shared SDK.
 *
 * Use this in route handlers that do their DB work via the admin client (so RLS
 * isn't relied on for the write). For cookie/RLS-scoped writes keep using
 * `createClient()` directly until those routes are migrated to a token-scoped
 * client.
 */
export async function getRequestUser(request: Request): Promise<{ id: string } | null> {
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      try {
        const { data } = await createAdminClient().auth.getUser(token);
        if (data.user) return { id: data.user.id };
      } catch {
        /* fall through to cookie auth */
      }
    }
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { id: user.id } : null;
  } catch {
    return null;
  }
}
