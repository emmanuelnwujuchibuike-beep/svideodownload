import { NextResponse } from "next/server";

import { giftHistory } from "@/lib/gift/history";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gift/history?box=received|sent&cursor=… — the signed-in member's Gift Box (Frenz Gift Coin Part 5): their own
 * gifts only, newest first, from each gift's stored snapshot (lib/gift/history.ts).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = new URL(request.url);
  const box = url.searchParams.get("box");
  if (box !== "received" && box !== "sent") return NextResponse.json({ error: "Choose received or sent." }, { status: 400 });
  const r = await giftHistory(user.id, box, { cursor: url.searchParams.get("cursor"), limit: Number(url.searchParams.get("limit") ?? 20) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ items: r.items, next: r.next, counts: r.counts }, { headers: { "cache-control": "private, no-store" } });
}
