import { NextResponse } from "next/server";
import { z } from "zod";

import { hasResend, sendOtpEmail } from "@/lib/email/resend";
import { clientId, otpLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(254) });

/**
 * POST /api/auth/otp — send a 6-digit sign-in code to this email via Resend.
 *
 * Passwordless: the code comes from Supabase Auth (admin.generateLink), so
 * verification stays 100% standard `verifyOtp` on the client — we only take
 * over DELIVERY to get the premium branded email instead of Supabase's stock
 * SMTP template. New emails are auto-provisioned (sign-up and sign-in are the
 * same flow); the code itself proves ownership at verify time. Rate-limited
 * per IP AND per email; responses never reveal whether an account exists.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  // Both limits: an attacker rotating emails hits the IP wall; one rotating
  // IPs still can't hammer a single inbox.
  const [byIp, byEmail] = await Promise.all([
    otpLimiter.limit(`otp:ip:${clientId(request.headers)}`),
    otpLimiter.limit(`otp:email:${email}`),
  ]);
  if (!byIp.success || !byEmail.success) {
    return NextResponse.json({ error: "Too many codes requested — wait a minute and try again." }, { status: 429 });
  }

  if (!hasResend) return NextResponse.json({ error: "Sign-in email isn't configured yet." }, { status: 503 });

  const admin = createAdminClient();
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    // Unknown email → provision the account and retry (sign-up === sign-in).
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) {
      return NextResponse.json({ error: "Couldn't send the code. Try again." }, { status: 500 });
    }
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) {
      return NextResponse.json({ error: "Couldn't send the code. Try again." }, { status: 500 });
    }
  }

  const code = link.data.properties?.email_otp;
  if (!code) return NextResponse.json({ error: "Couldn't send the code. Try again." }, { status: 500 });

  const sent = await sendOtpEmail(email, code);
  if (!sent) return NextResponse.json({ error: "Couldn't send the email. Try again." }, { status: 502 });

  // Supabase's OTP length is a dashboard setting (6–10 digits) — tell the
  // client how many boxes to render so auto-verify always fires on the real
  // last digit, whatever the project is configured to.
  return NextResponse.json({ ok: true, codeLength: code.length });
}
