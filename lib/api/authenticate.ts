import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Unified first-party authentication for `/api/v1/app/*`.
 *
 * The web app authenticates with the Supabase **session cookie**; native (iOS,
 * Android) and desktop clients can't use cookies, so they send the Supabase
 * **access token** as `Authorization: Bearer <jwt>`. Both resolve to the same
 * user here, which is what lets one backend serve all four clients identically.
 *
 *   web      → cookie (handled by @supabase/ssr server client)
 *   native   → Authorization: Bearer <supabase access_token>
 *   desktop  → Authorization: Bearer <supabase access_token>
 *
 * Bearer is checked first (cheaper, stateless) and falls back to the cookie
 * session. Returns the authenticated user's id/email or null for anonymous.
 */
export interface SessionUser {
  id: string;
  email: string | null;
  /** "bearer" for native/desktop tokens, "cookie" for the web session. */
  via: "bearer" | "cookie";
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

/** Resolve the current user, or null if the request is anonymous. */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  // 1) Bearer access token (native + desktop). Validated against Supabase Auth.
  const token = bearer(request);
  if (token) {
    try {
      const { data, error } = await createAdminClient().auth.getUser(token);
      if (!error && data.user) {
        return { id: data.user.id, email: data.user.email ?? null, via: "bearer" };
      }
    } catch {
      /* fall through to cookie */
    }
  }

  // 2) Session cookie (web).
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? null, via: "cookie" };
  } catch {
    /* anonymous */
  }

  return null;
}

/** Like getSessionUser but for endpoints that require a signed-in user. */
export async function requireUser(request: Request): Promise<SessionUser | { unauthorized: true }> {
  const user = await getSessionUser(request);
  return user ?? { unauthorized: true };
}
