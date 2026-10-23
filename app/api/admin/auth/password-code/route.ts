import { NextResponse } from "next/server";

import { checkLoginAllowed, noteLoginFailure } from "@/lib/admin/login-throttle";
import { issuePasswordCode, maskEmail, PASSWORD_CODE_TTL_MINUTES } from "@/lib/auth/password-code";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { clientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email a signed-in administrator a six-digit code for changing their password from the dashboard
 * (lib/auth/password-code.ts). Admin-only: the code goes to the account's OWN email, never one in the request.
 * Each send counts on the login throttle, so the endpoint cannot be used to flood the inbox.
 */
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const email = gate.user.email;
  if (!email) return NextResponse.json({ error: "This admin account has no email to send a code to." }, { status: 400 });
  if (!hasResend) return NextResponse.json({ error: "Email sending is not set up (RESEND_API_KEY)." }, { status: 503 });

  const ip = clientId(request.headers);
  const allowed = await checkLoginAllowed(email, ip);
  if (!allowed.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfterSeconds) } },
    );
  }
  await noteLoginFailure(email, ip);

  const code = await issuePasswordCode(gate.user.id, "admin");
  if (!code) return NextResponse.json({ error: "Could not create a code." }, { status: 500 });

  const sent = await sendProductEmail(email, {
    subject: `${code} is your Frenz admin password code`,
    heading: "Change your admin password",
    intro: `Your code is ${code}. Enter it in the admin dashboard with your new password. It expires in ${PASSWORD_CODE_TTL_MINUTES} minutes.`,
    body: "Didn't ask for this? Someone signed in to your admin account requested it. Change your password and check Admin → Security.",
  });
  if (!sent) return NextResponse.json({ error: "The email could not be sent. Try again." }, { status: 502 });

  return NextResponse.json({ ok: true, sentTo: maskEmail(email), minutes: PASSWORD_CODE_TTL_MINUTES });
}
