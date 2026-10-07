import { NextResponse } from "next/server";

import { destinationFor, isShareToken, REF_COOKIE, REF_COOKIE_MAX_AGE, REF_PENDING_COOKIE } from "@/lib/referrals/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /r/<token> — a Frenzsave share link (rewards brief §6–§7, 2026-10-07).
 * Counts the click, remembers the token for a later sign-up (an httpOnly
 * first-party cookie; no IP is used), and sends the visitor to the shared
 * content. An unknown token still lands somewhere useful: the home page.
 * Nothing about the sharer is in the URL or the cookie except the token.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  if (!isShareToken(token)) return NextResponse.redirect(`${origin}/`, 307);
  const { data, error } = await createAdminClient().rpc("record_share_click", { p_token: token });
  const link = (error ? null : data) as { owner_id: string; content_type: string; content_id: string } | null;
  if (!link) return NextResponse.redirect(`${origin}/`, 307);
  const res = NextResponse.redirect(`${origin}${await destinationFor(link.content_type, link.content_id)}`, 307);
  // first touch wins: an existing token is not replaced by a later click
  if (!request.headers.get("cookie")?.includes(`${REF_COOKIE}=`)) {
    res.cookies.set(REF_COOKIE, token, { maxAge: REF_COOKIE_MAX_AGE, path: "/", httpOnly: true, sameSite: "lax", secure: true });
    res.cookies.set(REF_PENDING_COOKIE, "1", { maxAge: REF_COOKIE_MAX_AGE, path: "/", sameSite: "lax", secure: true });
  }
  res.headers.set("cache-control", "no-store");
  return res;
}
