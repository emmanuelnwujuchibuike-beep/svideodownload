import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE ADMIN AUTHORIZATION IS DECIDED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every admin page, every admin API route and every admin server action calls
 * into this module. Nothing decides admin-ness on its own, and nothing trusts
 * the client.
 *
 * ── 🔴 THE MIDDLEWARE IS NOT THE GUARD ────────────────────────────────────
 *
 * `middleware.ts` also gates `/admin/*`, and that is a convenience — it turns a
 * wrong URL into a redirect instead of a rendered error. It is NOT the security
 * boundary, for two reasons:
 *
 *  • Middleware runs on the PAGE request. `/api/admin/*` is a separate request
 *    that a determined caller can issue directly with `curl` and a stolen or
 *    ordinary session cookie. Protecting the dashboard does not protect the API.
 *  • Next's matcher is a string pattern. A route added outside the pattern, or a
 *    matcher edited later, silently removes the gate with nothing failing.
 *
 * So authorization is re-decided, server-side, on every protected request. The
 * middleware may be removed entirely without opening anything.
 *
 * ── `server-only` ─────────────────────────────────────────────────────────
 *
 * The import at the top makes a client component that imports this fail the
 * BUILD rather than shipping a bundle that leaks the check into the browser.
 * This project has already been caught by a client component importing a
 * server-only module, and `next build` — not `tsc` — is what surfaces it.
 */

/**
 * The authenticated administrator, or `null`.
 *
 * 🔴 `getUser()`, never `getSession()`. `getSession()` reads the JWT out of the
 * cookie and decodes it WITHOUT verifying it against the auth server, so a
 * forged or expired token satisfies it. `getUser()` revalidates with Supabase,
 * which is also what makes requirement 16 — "expired/revoked session attempts
 * to access admin APIs" — actually hold: a revoked session fails here even
 * though the cookie is still in the browser.
 */
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  /*
    The role comes from the DATABASE on every request, not from the JWT.

    A JWT is a snapshot: an admin who was demoted thirty seconds ago still
    carries `role: admin` in a token that has not expired. Reading `profiles`
    means a revoked administrator loses access on their very next request.

    The cost is one indexed primary-key lookup on a page that is not on any
    latency budget (/admin is one authenticated operator, explicitly outside the
    visitor budget).
  */
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  /*
    `isAdmin` accepts EITHER `profiles.role = 'admin'` OR a match in the
    ADMIN_EMAILS env var. Both are server-side facts:

     • the role column is now protected by a trigger (migration 0136) so a user
       cannot promote themselves — before that migration this branch was the
       privilege-escalation hole;
     • ADMIN_EMAILS is a server env var. It is deliberately NOT NEXT_PUBLIC_,
       so it never reaches the browser, and `user.email` here comes from the
       verified `getUser()` response rather than from anything the client sent.
  */
  return isAdmin(profile?.role, user.email) ? user : null;
}

/**
 * For PAGES and layouts under `/admin`.
 *
 * Redirects rather than throwing, so an operator whose session expired lands on
 * the login form with their destination preserved instead of on an error page.
 *
 * 🔴 A NON-ADMIN WHO IS SIGNED IN IS SENT AWAY, NOT TO THE LOGIN FORM. Offering
 * them a login box implies that logging in again might work, and it also
 * confirms that `/admin` is a real, reachable surface. They go to the site root
 * exactly as if the route did not concern them.
 */
export async function requireAdminPage(nextPath = "/admin"): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }

  const admin = await getAdminUser();
  if (!admin) redirect("/");

  return admin;
}

/**
 * For ROUTE HANDLERS under `/api/admin` and for server actions.
 *
 * Returns `{ user }` on success, or `{ response }` — an already-formed 404 —
 * that the caller must return immediately.
 *
 * ── 🔴 WHY 404 AND NOT 403 ────────────────────────────────────────────────
 *
 * 403 confirms the endpoint exists and that the caller simply lacks the role,
 * which is a free map of the admin surface for anyone enumerating routes. 404
 * says nothing. The operator never sees either, because the dashboard only
 * calls these while genuinely authorized.
 *
 * Usage — the early return is the whole contract:
 *
 *     const gate = await requireAdminApi();
 *     if (!gate.ok) return gate.response;
 *     // gate.user is a verified administrator from here on
 */
export type AdminGate =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

export async function requireAdminApi(): Promise<AdminGate> {
  const user = await getAdminUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  return { ok: true, user };
}

/**
 * For SERVER ACTIONS, where there is no Response to return.
 *
 * Throws a generic error. A server action that reaches this line was called by
 * something other than the dashboard, so there is no user experience to
 * protect — only an audit trail not to hand out.
 */
export async function requireAdminAction(): Promise<User> {
  const user = await getAdminUser();
  if (!user) throw new Error("Not authorized");
  return user;
}
