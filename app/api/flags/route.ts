import { NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin";
import { getUserPlan } from "@/lib/monetization/plan";
import { type FlagContext, getClientReadableFlags, resolveFlag } from "@/lib/platform/flags";
import { getFlagOverrides } from "@/lib/platform/flags-store";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public flag read for the client — the half of the flag system that lets a
 * client island or a statically-generated page gate on a flag. Returns ONLY the
 * resolved boolean of each `clientReadable` flag, for the caller's own context.
 * Never exposes rollout %, overrides, or another user's assignment.
 *
 * ── Caching ───────────────────────────────────────────────────────────────────
 *
 * For an anonymous caller the answer is identical for everyone (a partial rollout
 * resolves off without a user to bucket), so it is CDN-cacheable — which matters
 * because anon is the common case on the static/marketing surface. For a signed-in
 * caller it varies by user (plan, rollout bucket, admin preview), so it is private
 * and uncached.
 */
export async function GET() {
  const flags = getClientReadableFlags();

  // Nothing exposed ⇒ don't even touch the session; empty, cacheable.
  if (flags.length === 0) {
    return NextResponse.json(
      { flags: {} },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let ctx: FlagContext;
  if (!user) {
    ctx = { plan: "free", isAdmin: false, userId: null };
  } else {
    const [plan, profileRes] = await Promise.all([
      getUserPlan(user.id),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
    ]);
    ctx = {
      plan,
      isAdmin: isAdmin(profileRes.data?.role, user.email),
      userId: user.id,
    };
  }

  const overrides = await getFlagOverrides();
  const resolved: Record<string, boolean> = {};
  for (const f of flags) resolved[f.id] = resolveFlag(f, overrides[f.id], ctx);

  return NextResponse.json(
    { flags: resolved },
    {
      headers: {
        "Cache-Control": user
          ? "private, no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
