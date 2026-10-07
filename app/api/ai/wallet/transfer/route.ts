import { NextResponse } from "next/server";
import { z } from "zod";

import { sendCredits } from "@/lib/ai/wallet/transfers";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ accountNumber: z.string().trim().max(14), credits: z.number().int().positive().max(100_000_000), idempotencyKey: z.string().max(80), note: z.string().max(200).nullable().optional() }).strict();

/**
 * POST /api/ai/wallet/transfer — send credits to a wallet number (0193). The
 * sender is the session; the fee, bounds and balance are the server's; the
 * idempotency key makes a retried tap the same transfer, never a second one.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`wallet-transfer:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many transfers — wait a moment." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const out = await sendCredits({
    senderId: user.id,
    accountNumber: parsed.data.accountNumber.replace(/\s+/g, ""),
    credits: parsed.data.credits,
    idempotencyKey: parsed.data.idempotencyKey,
    note: parsed.data.note ?? null,
    config: settings.frenzAiPlans.wallet.transfers,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
