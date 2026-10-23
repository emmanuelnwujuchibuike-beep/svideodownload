import { bearer, getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { checkPasswordCode, clearPasswordCode, MIN_MEMBER_PASSWORD_LENGTH, passwordChangeNeedsCode, signInMethod } from "@/lib/auth/password-code";
import { securityEventLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

async function accessToken(request: Request): Promise<string | null> {
  const token = bearer(request);
  if (token) return token;
  const { data } = await (await createClient()).auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * POST /api/v1/app/security/password — set or change the member's password: `{ password, code? }`. Answers
 * `forbidden` with details `{ needsCode: true }` when a code is needed and missing or wrong.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");
  const { success } = await securityEventLimiter.limit(`password-set:${user.id}`);
  if (!success) return fail("rate_limited", "Too many tries. Wait a few minutes.");

  let password = "";
  let code = "";
  try {
    const body = (await request.json()) as { password?: unknown; code?: unknown };
    password = typeof body.password === "string" ? body.password : "";
    code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  } catch {
    return fail("bad_request", "Enter a new password.");
  }
  if (password.length < MIN_MEMBER_PASSWORD_LENGTH) return fail("validation_failed", `At least ${MIN_MEMBER_PASSWORD_LENGTH} characters.`);

  const needsCode = passwordChangeNeedsCode(signInMethod(await accessToken(request)));
  if (needsCode) {
    if (!code) return fail("forbidden", "Enter the code we email you to change your password.", { needsCode: true });
    if (!(await checkPasswordCode(user.id, code, "member"))) {
      return fail("forbidden", "That code is wrong or has expired. Send a new one.", { needsCode: true });
    }
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, { password });
  if (error) return fail("bad_request", "Couldn't save the password. Try a different one.");
  if (needsCode) await clearPasswordCode("member");
  return noStore(ok({ ok: true }));
}
