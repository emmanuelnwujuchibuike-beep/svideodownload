import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { isEnabled } from "@/lib/platform/flags-store";

import { mergeAnonymousStreak } from "./engine";
import { anonCookie, isSecureRequest, readAnonId, resolveIdentity, type StreakIdentity } from "./identity";

/**
 * The per-request preamble every streak route shares: who is asking, is the
 * feature on, and has an anonymous streak just become an account's.
 *
 * Written once here rather than in each route so the three of them cannot drift
 * on the two things that must never differ — the flag gate and the merge.
 */

export interface StreakRequestContext {
  identity: StreakIdentity;
  /** False when the kill switch is off; routes must then do nothing. */
  enabled: boolean;
  /** Set when this response should plant a new anonymous identity. */
  setCookie: string | null;
}

export async function streakContext(request: Request): Promise<StreakRequestContext> {
  const user = await getRequestUser(request).catch(() => null);
  const identity = resolveIdentity(request, user?.id ?? null);

  let enabled = true;
  try {
    /*
      🔴 PLAN AND ADMIN ARE NOT LOOKED UP, ON PURPOSE. Resolving them means two
      extra database round trips on the hottest path in this feature — it runs
      on every page open, for every visitor, signed in or not — and neither
      streak flag declares `plans` or `adminBypass`, so both values are inert
      inside `resolveFlag`. A test in flags.test.ts asserts that stays true; if
      someone ever plan-gates a streak flag, it fails and points here.
    */
    enabled = await isEnabled("streak-system", {
      plan: "free",
      isAdmin: false,
      userId: user?.id ?? null,
    });
  } catch {
    /*
      A flag-store failure must not take the feature down with it. The flag is a
      kill switch, and the safe default for a kill switch that cannot be read is
      the shipped behaviour — anything else means one flaky read silently stops
      recording everybody's streak.
    */
    enabled = true;
  }

  /*
    🔴 THE MERGE RUNS ON EVERY AUTHENTICATED REQUEST THAT STILL CARRIES AN ANON
    COOKIE, not "on sign-in". There is no single server-observable sign-in
    moment — auth is a cookie that simply starts being present — so the merge
    has to be something safe to attempt repeatedly. `mergeRecords` is idempotent
    and the anonymous row is deleted once folded in, so the second attempt finds
    nothing to do and costs one indexed lookup.
  */
  if (identity.kind === "user" && identity.anonId && enabled) {
    await mergeAnonymousStreak(identity.userId, identity.anonId);
  }

  // Only plant a cookie when the visitor arrived without one.
  const setCookie =
    identity.kind === "anon" && !readAnonId(request)
      ? anonCookie(identity.anonId, isSecureRequest(request))
      : null;

  return { identity, enabled, setCookie };
}

/** JSON, never cached, with the anonymous identity attached when it is new. */
export function streakResponse(body: unknown, ctx: StreakRequestContext): NextResponse {
  const res = NextResponse.json(body, {
    // Private + no-store: this is per-identity and changes at local midnight.
    headers: { "Cache-Control": "private, no-store" },
  });
  if (ctx.setCookie) res.headers.append("Set-Cookie", ctx.setCookie);
  return res;
}
