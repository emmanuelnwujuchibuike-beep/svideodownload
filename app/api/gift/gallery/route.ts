import { NextResponse } from "next/server";

import { giftGallery } from "@/lib/gift/gifts-server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gift/gallery — the sticker gallery for the signed-in member (Frenz Gift Coin Part 4): the published, not
 * archived stickers (gift_sticker_gallery), the member's FGC wallet with any due gift earnings released first
 * (gift_wallet_summary), and whether gifting is configured. One request per gallery open: the sheet reuses it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const r = await giftGallery(user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ stickers: r.stickers, wallet: r.wallet, giftingReady: r.giftingReady }, { headers: { "cache-control": "private, no-store" } });
}
