import { NextResponse } from "next/server";

import { coinHistory } from "@/lib/coin/wallet";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/coin/history?cursor=&limit= — the signed-in member's Frenz Coin activity, newest first, 20 a page (50 at most). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const out = await coinHistory(user.id, { cursor: sp.get("cursor"), limit: sp.get("limit") ? Number(sp.get("limit")) : null });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "private, no-store" } });
}
