import { NextResponse } from "next/server";

import { getWalletNumber } from "@/lib/ai/wallet/transfers";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/wallet/account — the member's own 10-digit wallet number (made on first ask, 0193). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`wallet-account:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const accountNumber = await getWalletNumber(user.id);
  if (!accountNumber) return NextResponse.json({ error: "Couldn't load your wallet number." }, { status: 503 });
  return NextResponse.json({ accountNumber }, { headers: { "cache-control": "no-store" } });
}
