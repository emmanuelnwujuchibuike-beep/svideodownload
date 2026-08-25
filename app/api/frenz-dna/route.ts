import { NextResponse } from "next/server";

import { resetFrenzDna } from "@/lib/social/frenz-dna";
import { bustHomeFeedCache } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/frenz-dna — Discovery Controls "Reset personalization"
 * (Feature 15 Part 8). Clears the persisted FrenzDNA™ interest profile only;
 * boosted/muted categories and the Home layout are reset independently via
 * /api/home-preferences (same separation HomeModulesEditor's own reset
 * already keeps).
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  await resetFrenzDna(user.id);
  void bustHomeFeedCache(user.id);
  return NextResponse.json({ ok: true });
}
