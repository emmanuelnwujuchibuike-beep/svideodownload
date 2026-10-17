import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { feedPreviews } from "@/lib/sub/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { ids } — fresh five-minute preview links for Exclusive feed tiles whose links ran out
 * (Part 15). The ids prove nothing: access is decided again on the server, exactly as for a feed
 * page; posts the viewer may no longer see are left out of the answer. Nothing here is cached.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in to see your exclusive feed." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-feed-previews:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const out = await feedPreviews(user.id, body?.ids);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  const { ok: _ok, ...answer } = out;
  return NextResponse.json(answer, { headers });
}
