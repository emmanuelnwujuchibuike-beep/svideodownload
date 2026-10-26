import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { announceCoinPinChange } from "@/lib/coin/notify";
import { completeCoinPinReset } from "@/lib/coin/pin";
import { getLandingSettings } from "@/lib/landing/settings";
import { clientId, pinLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().max(12), pin: z.string().max(12), confirm: z.string().max(12) }).strict();

/**
 * POST /api/coin/pin/reset/confirm — the emailed code and a new transaction PIN (typed twice) (Part 4.2). The code is
 * checked IN the database against its stored HMAC: the live one only, once, before it expires, within a few tries.
 * Success sets the new PIN, clears the locks and voids any PIN entry begun before — one transaction. A wrong, used,
 * expired or replaced code is one answer.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin-reset-confirm:${user.id}`), pinLimiter.limit(`coin-pin-reset-confirm-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const out = await completeCoinPinReset(user.id, parsed.data.code, parsed.data.pin, parsed.data.confirm, settings.frenzCoin);
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  // closeout: in-app + an email to the confirmed address, after the reset committed, once (never the PIN or the code)
  after(() => announceCoinPinChange(user, "reset", randomUUID()));
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
