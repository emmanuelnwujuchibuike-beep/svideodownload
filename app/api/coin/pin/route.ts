import { NextResponse } from "next/server";
import { z } from "zod";

import { coinPinStatus, pinPepper, setCoinPin } from "@/lib/coin/pin";
import { clientId, pinLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/coin/pin — the signed-in member's own transaction-PIN state: set, locked until (never the hash). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!pinPepper()) return NextResponse.json({ available: false, set: false, lockedUntil: null }, { headers: { "cache-control": "private, no-store" } });
  const s = await coinPinStatus(user.id);
  if (!s) return NextResponse.json({ error: "Couldn't load that right now." }, { status: 503 });
  return NextResponse.json({ available: true, ...s }, { headers: { "cache-control": "private, no-store" } });
}

const schema = z.object({ pin: z.string().max(12), confirm: z.string().max(12) }).strict();

/**
 * POST /api/coin/pin — set the Frenz Coin TRANSACTION PIN for the first time (Part 4.2). Six digits, typed twice;
 * confirmed email; never replaces an existing PIN (change or reset does that). Only a scrypt hash of HMAC(pepper, PIN)
 * is stored (lib/coin/pin.ts). Not the messaging quick-lock PIN.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin-set:${user.id}`), pinLimiter.limit(`coin-pin-set-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (!user.email_confirmed_at) return NextResponse.json({ error: "Confirm your email address before setting a transaction PIN.", reason: "email_unconfirmed" }, { status: 403 });
  const out = await setCoinPin(user.id, parsed.data.pin, parsed.data.confirm);
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
