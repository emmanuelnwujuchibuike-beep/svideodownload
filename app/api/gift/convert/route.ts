import { NextResponse } from "next/server";
import { z } from "zod";

import { convertFgc, loadConversionRules } from "@/lib/gift/conversion";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    direction: z.enum(["fc_to_fgc", "fgc_to_fc"]),
    // input units: US cents (FC) or FGC minor units. The database applies the admin's min/max.
    amount: z.number().int().positive().max(99_999_999_999),
    idempotencyKey: z.string().max(80),
    // the rules version the member was shown: a changed rate is refused (rules_changed), never silently applied
    expectedVersion: z.number().int().positive().nullable().optional(),
  })
  .strict();

/**
 * GET /api/gift/convert — the rules a conversion preview is drawn with (Part 5): whether conversion is configured, the
 * rules version (sent back as expectedVersion, so a rate changed in between is refused) and the two legs' public
 * figures. A preview only: the server and the database price the conversion again when it runs (convert_fgc).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const rules = await loadConversionRules();
  return NextResponse.json(rules.ok ? { configured: true, rules: rules.rules } : { configured: false, rules: null }, { headers: { "cache-control": "private, no-store" } });
}

/**
 * POST /api/gift/convert — convert between the member's own Frenz Coins and Frenz Gift Coins (Part 2, 0290). The member
 * is the session. The rate, fee, limits, balance and standing are the database's (convert_fgc, under both wallet
 * locks), with the server's rules. A retry with the same idempotency key answers the first conversion.
 *
 * Refused while the rules are missing or invalid (`config_missing` / `config_invalid`) and while the Frenz Coin wallet
 * itself is off (the existing frenzCoin switch) — nothing moves.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`gift-convert:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many conversions — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const [settings, rules] = await Promise.all([getLandingSettings(), loadConversionRules()]);
  if (!settings.frenzCoin.enabled) return NextResponse.json({ error: "Frenz Coin isn't available right now.", reason: "disabled" }, { status: 503 });
  const out = await convertFgc({
    userId: user.id,
    direction: parsed.data.direction,
    amount: parsed.data.amount,
    idempotencyKey: parsed.data.idempotencyKey,
    expectedVersion: parsed.data.expectedVersion ?? null,
    rules,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
