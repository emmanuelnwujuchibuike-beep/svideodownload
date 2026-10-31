import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { exclusiveFeed } from "@/lib/sub/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?cursor= | ?seed=&since= — the signed-in viewer's Exclusive feed (Frenz Exclusive Part 3): posts
 * from the creators they actively subscribe to, plus locked previews to discover on the first page.
 * A first page takes the visit's seed and last-visit time (lib/sub/feed-order.ts: new first, then
 * reshuffled per visit); a later page's cursor carries both. Access is decided on the server on every
 * request; nothing here is cached.
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
  const sp = new URL(request.url).searchParams;
  const since = Number(sp.get("since") ?? "");
  const out = await exclusiveFeed(user.id, sp.get("cursor"), { seed: sp.get("seed"), since: Number.isFinite(since) && since > 0 ? since : null });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  const { ok: _ok, ...page } = out;
  return NextResponse.json(page, { headers });
}
