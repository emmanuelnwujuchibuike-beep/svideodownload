import type { User } from "@supabase/supabase-js";

import { securityScore, type SecurityInputs, type SecurityScore } from "@/lib/security/score";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Gather the Security Score's inputs from the tables that already hold them
 * (Feature 18 · Part 19).
 *
 * Nothing new is stored. Passkeys are 0058, recovery counters 0055, the PIN
 * 0056, trusted devices 0054, and MFA + email confirmation come off the auth
 * session itself.
 *
 * Every read is independent and fails to the SAFE side, which here means
 * "assume the protection is absent". A blip that under-reports makes the score
 * nag about something already done — mildly annoying. A blip that
 * over-reported would tell someone they have two-factor enabled when they do
 * not, which is the one outcome a security screen must never produce.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function count(table: string, userId: string, filter?: [string, unknown]): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    let q = createAdminClient().from(table).select("user_id", { head: true, count: "exact" }).eq("user_id", userId);
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: n, error } = await q;
    return error ? 0 : (n ?? 0);
  } catch {
    return 0;
  }
}

export async function getSecurityInputs(user: User): Promise<SecurityInputs> {
  // MFA comes from the session's own factor list — the authority, and free.
  const mfaEnabled = (user.factors ?? []).some((f) => f.status === "verified");

  const [passkeyCount, pinCount, trustedDeviceCount, settings] = await Promise.all([
    count("webauthn_credentials", user.id),
    count("security_pin", user.id),
    count("trusted_devices", user.id, ["is_trusted", true]),
    (async () => {
      if (!hasSupabase) return null;
      try {
        const { data, error } = await createAdminClient()
          .from("account_security_settings")
          .select("recovery_codes_remaining, require_stepup_on_new_device")
          .eq("user_id", user.id)
          .maybeSingle();
        return error ? null : (data as { recovery_codes_remaining: number; require_stepup_on_new_device: boolean } | null);
      } catch {
        return null;
      }
    })(),
  ]);

  return {
    mfaEnabled,
    passkeyCount,
    recoveryCodesRemaining: settings?.recovery_codes_remaining ?? 0,
    pinSet: pinCount > 0,
    trustedDeviceCount,
    emailConfirmed: !!user.email_confirmed_at,
    stepUpOnNewDevice: settings?.require_stepup_on_new_device === true,
  };
}

/** The signed-in member's score, or null when there is no session. */
export async function getSecurityScore(): Promise<SecurityScore | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return securityScore(await getSecurityInputs(user));
  } catch {
    return null;
  }
}
