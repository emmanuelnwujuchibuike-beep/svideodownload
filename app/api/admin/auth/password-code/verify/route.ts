import { NextResponse } from "next/server";

import { checkLoginAllowed, clearLoginFailures, noteLoginFailure } from "@/lib/admin/login-throttle";
import { checkPasswordCode, clearPasswordCode } from "@/lib/auth/password-code";
import { validateAdminPassword } from "@/lib/admin/password-policy";
import { markReauthenticated } from "@/lib/admin/reauth";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { clientId } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Check the emailed code and set the new password (lib/auth/password-code.ts). On success the code is spent,
 * every OTHER session of this account is signed out, and the admin counts as freshly re-authenticated, so the
 * sensitive action that asked for the password (a Paystack key, a price) goes straight through.
 */
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const email = gate.user.email ?? "";

  let code = "";
  let password = "";
  try {
    const body = (await request.json()) as { code?: unknown; password?: unknown };
    code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Enter the code and a new password." }, { status: 400 });
  }

  const ip = clientId(request.headers);
  const allowed = await checkLoginAllowed(email, ip);
  if (!allowed.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfterSeconds) } },
    );
  }

  if (!(await checkPasswordCode(gate.user.id, code, "admin"))) {
    await noteLoginFailure(email, ip);
    return NextResponse.json({ error: "That code is wrong or has expired. Send a new one." }, { status: 400 });
  }

  const verdict = validateAdminPassword(password);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });

  const { error } = await createAdminClient().auth.admin.updateUserById(gate.user.id, { password });
  if (error) {
    // Supabase's message is not forwarded (it can confirm the old password on a same-password rejection)
    return NextResponse.json({ error: "Could not update the password. Try a different one." }, { status: 400 });
  }

  await clearPasswordCode("admin");
  await clearLoginFailures(email, ip);
  try {
    await (await createClient()).auth.signOut({ scope: "others" });
  } catch {
    // the password already changed; other devices fall out when their tokens next refresh
  }
  await markReauthenticated(gate.user.id);
  return NextResponse.json({ ok: true });
}
