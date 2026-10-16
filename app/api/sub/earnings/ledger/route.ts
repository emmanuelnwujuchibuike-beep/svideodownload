import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { ledgerPage } from "@/lib/sub/earnings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?filter=&from=&to=&cursor= — the signed-in creator's OWN ledger, 25 a page, newest first (Part 7). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-ledger:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const p = new URL(request.url).searchParams;
  const out = await ledgerPage(user.id, { cursor: p.get("cursor"), filter: p.get("filter"), from: p.get("from"), to: p.get("to") });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  return NextResponse.json({ items: out.items, next: out.next }, { headers });
}
