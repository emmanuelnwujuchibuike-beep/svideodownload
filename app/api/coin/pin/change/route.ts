import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { announceCoinPinChange } from "@/lib/coin/notify";
import { changeCoinPin } from "@/lib/coin/pin";
import { getLandingSettings } from "@/lib/landing/settings";
import { clientId, pinLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ currentPin: z.string().max(12), pin: z.string().max(12), confirm: z.string().max(12) }).strict();

/**
 * POST /api/coin/pin/change — change the transaction PIN with the CURRENT PIN (Part 4.2). The current PIN goes through
 * the same counted, lockable attempt as a transfer; the new one replaces it in the same database transaction. Audited
 * (coin_pin_changed) — never the PIN or its hash.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin:${user.id}`), pinLimiter.limit(`coin-pin-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const out = await changeCoinPin(user.id, parsed.data.currentPin, parsed.data.pin, parsed.data.confirm, settings.frenzCoin);
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  // closeout: in-app + an email to the confirmed address, after the change committed, once (never the PIN)
  after(() => announceCoinPinChange(user, "change", randomUUID()));
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
