import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { issuePasswordCode, maskEmail, PASSWORD_CODE_TTL_MINUTES } from "@/lib/auth/password-code";
import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { securityEventLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * POST /api/v1/app/security/password/code — email the signed-in member a six-digit code for changing their
 * password (lib/auth/password-code.ts). Needed when this session signed in WITH a password (owner, 2026-10-23):
 * the same proof of the inbox the "Forgot password?" flow asks for. Always the account's own email.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");
  if (!user.email) return fail("bad_request", "This account has no email to send a code to.");
  if (!hasResend) return fail("unavailable", "Email codes are not available right now.");
  const { success } = await securityEventLimiter.limit(`password-code:${user.id}`);
  if (!success) return fail("rate_limited", "Too many codes. Try again in a few minutes.");

  const code = await issuePasswordCode(user.id, "member");
  if (!code) return fail("internal");
  const sent = await sendProductEmail(user.email, {
    subject: `${code} is your Frenz password code`,
    heading: "Change your password",
    intro: `Your code is ${code}. Enter it on Account → Password with your new password. It expires in ${PASSWORD_CODE_TTL_MINUTES} minutes.`,
    body: "Didn't ask for this? Someone signed in to your account requested it. Review your devices in Account → Security.",
  });
  if (!sent) return fail("upstream_error", "The email could not be sent. Try again.");
  return noStore(ok({ sentTo: maskEmail(user.email), minutes: PASSWORD_CODE_TTL_MINUTES }));
}
