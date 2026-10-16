import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { creatorSubscribers } from "@/lib/sub/subscriptions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?filter=current|all&cursor= — the signed-in creator's OWN paid subscribers, 30 a page
 * (Frenz Exclusive Part 5). The creator is always the session user: there is no creator id to
 * pass, so nobody can list someone else's subscribers. No amounts or payment details.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-list:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const params = new URL(request.url).searchParams;
  const out = await creatorSubscribers(user.id, { cursor: params.get("cursor"), filter: params.get("filter") === "all" ? "all" : "current" });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  return NextResponse.json({ items: out.items, next: out.next }, { headers });
}
