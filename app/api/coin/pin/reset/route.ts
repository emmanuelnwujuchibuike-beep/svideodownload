import { NextResponse } from "next/server";

import { requestCoinPinReset } from "@/lib/coin/pin";
import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { getLandingSettings } from "@/lib/landing/settings";
import { clientId, otpLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same body for every outcome: whether a code was sent, a PIN exists or a limit was reached is never said. */
const GENERIC = { ok: true, message: "If your account can reset a transaction PIN, a code is on its way to your confirmed email address." };

/**
 * POST /api/coin/pin/reset — email a code to reset a forgotten transaction PIN (Part 4.2). Needs the signed-in session
 * AND the account's CONFIRMED email: possession of both, never one. The code is 8 digits from the CSPRNG; only its
 * HMAC(pepper) is stored, for 10 minutes, single use, superseding any earlier code; a few per hour per member (in the
 * database) and per IP / member (here). Never logged.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const [byUser, byIp] = await Promise.all([otpLimiter.limit(`coin-pin-reset:${user.id}`), otpLimiter.limit(`coin-pin-reset-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
  const to = user.email_confirmed_at && user.email && user.email.includes("@") ? user.email : null;
  // no confirmed address, or email not configured here: the same answer, and nothing is issued
  if (!to || !hasResend) return NextResponse.json(GENERIC, { headers: { "cache-control": "no-store" } });
  const settings = await getLandingSettings();
  const out = await requestCoinPinReset(user.id, settings.frenzCoin, (code, minutes) =>
    sendProductEmail(to, {
      subject: "Your Frenz Coin PIN reset code",
      heading: "Reset your transaction PIN",
      intro: `Your code is ${code}. It expires in ${minutes} minutes and works once.`,
      body: "If you didn't ask to reset your Frenz Coin transaction PIN, ignore this email and don't share the code with anyone — Frenz will never ask you for it.",
    }),
  );
  if (!out.ok) return NextResponse.json({ error: "That isn't available right now. Try again shortly." }, { status: 503 });
  return NextResponse.json(GENERIC, { headers: { "cache-control": "no-store" } });
}
