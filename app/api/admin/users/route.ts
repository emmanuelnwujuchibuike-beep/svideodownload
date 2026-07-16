import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 25;

/**
 * GET /api/admin/users?q= — find ANY account so an admin can hide it.
 *
 * Owner (2026-07-16): "make admin can hide a users account from everyone for
 * security reasons."
 *
 * Almost all of that already existed and is deliberately reused rather than
 * rebuilt: `is_suspended` on `profiles` already hides an account EVERYWHERE
 * (profile page 404s via getProfile's `if (!row || row.is_suspended) return
 * null`, plus the home feed, explore feed, discovery, engagement lists, friend
 * activity, stories and broadcasts all filter on it), and
 * `POST /api/admin/moderation` with `action: "suspend"` already sets it.
 *
 * The ONLY real gap was reach: the moderation queue can only act on targets
 * that have been REPORTED (it lists `ReportedTarget`s), so an admin could not
 * proactively hide someone nobody had reported — exactly the "for security
 * reasons" case, which is by definition something an admin spots first. This
 * endpoint just makes every account findable; the hide itself still goes
 * through the existing, audited `moderate()` path so there is one write path
 * and one audit trail, not two.
 *
 * Admin-gated by `getAdminUser()` (the same guard every other admin route
 * uses), and it reads via the service-role client — so a suspended account
 * stays visible HERE even though it is hidden everywhere else. That's the
 * point: an admin has to be able to find someone to un-hide them.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const db = createAdminClient();

  let query = db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, is_verified, is_suspended, created_at")
    .not("handle", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (q) {
    // Escape PostgREST's `or()` filter metacharacters before interpolating.
    // `,` splits the filter list and `)` closes it, so an unescaped handle
    // could inject extra filter terms into this query. `%` and `_` are `like`
    // wildcards — harmless but they'd make search behave oddly. Not a
    // hypothetical: `q` is raw user input reaching a query builder.
    const safe = q.replace(/[,()%_\\]/g, (c) => `\\${c}`);
    query = query.or(`handle.ilike.%${safe}%,display_name.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Search failed." }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}
