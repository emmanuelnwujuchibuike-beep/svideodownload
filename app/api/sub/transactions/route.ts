import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { myTransactions } from "@/lib/sub/subscriptions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?cursor= — the signed-in member's own subscription payments, 20 a page, newest first
 * (Frenz Exclusive Part 5). Statuses are the database's: only a charge Paystack verified on the
 * server ever reads as paid. No provider ids, checkout links or card details leave the server.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in to see your payments." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-tx:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const out = await myTransactions(user.id, new URL(request.url).searchParams.get("cursor"));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  return NextResponse.json({ items: out.items, next: out.next }, { headers });
}
