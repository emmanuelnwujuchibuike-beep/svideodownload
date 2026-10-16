import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { earningsOverview, isPeriod } from "@/lib/sub/earnings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?days=7|30|90 — the signed-in creator's OWN balances and period analytics (Part 7). Never anyone else's. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
  const { success } = await trackLimiter.limit(`sub-earn:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  if (!isPeriod(days)) return NextResponse.json({ error: "Choose 7, 30 or 90 days." }, { status: 400, headers });
  const out = await earningsOverview(user.id, days);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers });
  const { ok: _ok, ...body } = out;
  return NextResponse.json(body, { headers });
}
