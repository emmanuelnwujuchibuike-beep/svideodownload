import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { applyForQualification } from "@/lib/rewards/qualification";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/rewards/qualification — the member applies for withdrawal approval (0191). The session is the member; the thresholds are checked on the server. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`reward-qualify:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  const out = await applyForQualification(user.id, (await getLandingSettings()).frenzRewards);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, status: "applied" });
}
