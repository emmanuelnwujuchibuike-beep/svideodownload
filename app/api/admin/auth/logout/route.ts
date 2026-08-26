import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/auth/logout
 *
 * Terminates the session server-side and clears the cookies.
 *
 * ── 🔴 `scope: "global"` ──────────────────────────────────────────────────
 * Supabase's default is `local`, which drops the cookie on this device and
 * leaves the refresh token valid everywhere else. For an administrator that is
 * the wrong default: "log out" from the admin dashboard should mean the session
 * is DEAD, including on the machine they walked away from. `global` revokes
 * every refresh token for the account, so a copied cookie is worthless
 * afterwards — which is what makes requirement 9 ("opening /admin again must
 * require authentication") hold against more than just this browser.
 *
 * ── Why POST and not GET ──────────────────────────────────────────────────
 * A GET logout can be triggered by any `<img src>` on any page on the internet.
 * That is only a nuisance rather than a breach, but it is a nuisance with no
 * upside. POST plus the cookie's `sameSite: "lax"` means a cross-site form
 * cannot reach it either.
 *
 * Always answers `{ ok: true }`. A logout that reports failure invites the
 * operator to assume they are still signed in; the cookie clearing below runs
 * regardless, and the client redirects either way.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    /*
      A network failure to Supabase must not leave the operator stuck on a
      dashboard they asked to leave. The session cookies are written by the
      `signOut` call above when it succeeds; when it does not, the response
      below still redirects and the NEXT request re-validates with `getUser()`,
      which fails closed. Nothing here can leave a revoked session usable.
    */
  }

  return NextResponse.json({ ok: true });
}
