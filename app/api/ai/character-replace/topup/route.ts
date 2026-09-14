import { NextResponse } from "next/server";

import { beginCharacterReplaceTopup } from "@/lib/ai/character-replace/topup-server";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/character-replace/topup — begin a recharge of the Frenz AI
 * balance (the Character Replace product wallet — the ONE wallet since 0155).
 *
 * Part 3, §3: "Use the existing Paystack payment infrastructure… The recharge
 * transaction must identify product = character_replace." The Paystack
 * metadata carries `purpose: frenz_cr_topup`, so the webhook and the
 * verify-on-return route credit `ai_product_balances`. The bounds and the
 * reference are the server's — see lib/ai/character-replace/topup-server.ts.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add balance." }, { status: 401 });

  const burst = await aiJobCreateLimiter.limit(`ai-cr-topup:${user.id}`);
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
  const started = await beginCharacterReplaceTopup({ userId: user.id, email: user.email, amountCents: b.amountCents, returnTo: b.returnTo });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
  return NextResponse.json({ url: started.url });
}
