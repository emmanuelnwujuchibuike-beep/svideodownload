import { NextResponse } from "next/server";
import { z } from "zod";

import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { requestWithdrawal } from "@/lib/rewards/withdrawals";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ credits: z.number().int().positive().max(100_000_000), method: z.string().max(30), details: z.record(z.string().max(30), z.string().max(200)) }).strict();

/**
 * POST /api/rewards/withdrawals — ask to cash out WITHDRAWABLE credits (brief
 * §14). The amount is a number of credits; the cash value, the limits, the
 * review state and whether those credits are withdrawable at all are the
 * server's (lib/rewards/withdrawals.ts → request_withdrawal). Payout is by an
 * admin; nothing here says paid.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`rewards-withdraw:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const out = await requestWithdrawal({ userId: user.id, credits: parsed.data.credits, method: parsed.data.method, details: parsed.data.details, config: settings.frenzRewards });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, id: out.id, status: out.status, usdCents: out.usdCents });
}
