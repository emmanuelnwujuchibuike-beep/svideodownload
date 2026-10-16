import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { exclusiveFeed } from "@/lib/sub/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?cursor= — the signed-in viewer's Exclusive feed (Frenz Exclusive Part 3): posts from the
 * creators they actively subscribe to, keyset-paged, plus locked previews to discover on the
 * first page. Access is decided on the server on every request; nothing here is cached.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in to see your exclusive feed." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-feed:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const out = await exclusiveFeed(user.id, new URL(request.url).searchParams.get("cursor"));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  const { ok: _ok, ...page } = out;
  return NextResponse.json(page, { headers });
}
