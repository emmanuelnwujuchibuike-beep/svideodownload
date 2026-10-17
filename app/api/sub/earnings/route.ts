import { NextResponse } from "next/server";

import { subConfig, subEarnings } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in creator's own SUB balance, history and the withdrawal rules. Never anyone else's. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const [earnings, cfg] = await Promise.all([subEarnings(user.id), subConfig()]);
  return NextResponse.json(
    { earnings, rules: { withdrawalsEnabled: cfg.withdrawalsEnabled, withdrawalFeePercent: cfg.withdrawalFeePercent, minWithdrawalCents: cfg.minWithdrawalCents, flatFees: cfg.flatFees, autoPayout: cfg.autoPayout, requireQualification: cfg.requireQualification } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
