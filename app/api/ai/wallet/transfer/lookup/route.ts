import { NextResponse } from "next/server";

import { lookupWallet } from "@/lib/ai/wallet/transfers";
import { metadataLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/wallet/transfer/lookup?number= — whose wallet a number is, so the sender confirms before sending. Rate-limited: numbers cannot be enumerated cheaply. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await metadataLimiter.limit(`wallet-lookup:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many lookups — wait a moment." }, { status: 429 });
  const number = (new URL(request.url).searchParams.get("number") ?? "").replace(/\s+/g, "");
  const out = await lookupWallet(number, user.id);
  if (!out.ok) return NextResponse.json({ error: out.reason === "self" ? "That's your own wallet number." : out.reason === "invalid" ? "Enter a 10-digit wallet number." : "No wallet has that number." }, { status: out.reason === "not_found" ? 404 : 400 });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
