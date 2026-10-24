import { NextResponse } from "next/server";
import { z } from "zod";

import { paymentMarket } from "@/lib/payments/router";
import { trackLimiter } from "@/lib/rate-limit";
import { startSubCheckout } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ creatorId: z.string().uuid(), returnPath: z.string().max(300) }).strict();

/** POST — open (or reuse) a checkout for a SUB (Flutterwave first when enabled, else Paystack; the market from the edge only). The price and fee are the server's; access comes only from the provider's verified charge. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to subscribe." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-checkout:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const out = await startSubCheckout({ subscriberId: user.id, email: user.email ?? "", creatorId: parsed.data.creatorId, returnPath: parsed.data.returnPath, market: paymentMarket(req.headers) });
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
