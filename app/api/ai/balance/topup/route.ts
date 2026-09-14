import { NextResponse } from "next/server";

import { beginCharacterReplaceTopup } from "@/lib/ai/character-replace/topup-server";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/balance/topup — the Balance & usage page's recharge.
 *
 * ── 🔴 ONE WALLET (owner, 2026-09-14; migration 0155) ────────────────────────
 *
 * This used to mint a `frenz_ai_topup` payment into the AI Clean wallet. That
 * wallet is retired — its balances were moved into the Character Replace
 * product wallet, which is now THE Frenz AI balance — so this route and
 * /api/ai/character-replace/topup are the same operation: the same bounds,
 * the same `frenz_cr_topup` purpose, the same credit path. Kept at its old
 * address so the dashboard and any older bundle keep working.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add balance." }, { status: 401 });

  const burst = await aiJobCreateLimiter.limit(`ai-topup:${user.id}`);
  if (!burst.success) {
    return NextResponse.json({ error: "You're going a bit fast — give it a moment." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!user.email) return NextResponse.json({ error: "Add an email to your account first." }, { status: 400 });

  const b = (body ?? {}) as { amountCents?: unknown; returnTo?: unknown };
  const started = await beginCharacterReplaceTopup({
    userId: user.id,
    email: user.email,
    amountCents: b.amountCents,
    // The dashboard lives on the usage page; Paystack brings the member back there.
    returnTo: typeof b.returnTo === "string" ? b.returnTo : "/ai/usage",
  });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
  return NextResponse.json({ url: started.url });
}
