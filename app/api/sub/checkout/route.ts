import { NextResponse } from "next/server";
import { z } from "zod";

import { paymentCountry, paymentMarket } from "@/lib/payments/router";
import { trackLimiter } from "@/lib/rate-limit";
import { startSubCheckout } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 0277: the browser names an OPTION (a duration and, optionally, a promotion) — never an amount; the server prices it
const body = z.object({ creatorId: z.string().uuid(), returnPath: z.string().max(300), months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional(), promotionId: z.string().uuid().nullable().optional(), provider: z.enum(["flutterwave", "paystack"]).optional() }).strict();

/** POST — open (or reuse) a checkout for a SUB (Paystack first in Nigeria, Flutterwave first elsewhere, the member may switch; the market from the edge only). The price and fee are the server's; access comes only from the provider's verified charge. */
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
  const out = await startSubCheckout({ subscriberId: user.id, email: user.email ?? "", creatorId: parsed.data.creatorId, returnPath: parsed.data.returnPath, market: paymentMarket(req.headers), country: paymentCountry(req.headers), months: parsed.data.months, promotionId: parsed.data.promotionId ?? null, provider: parsed.data.provider });
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
