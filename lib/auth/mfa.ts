import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the CURRENT session needs an MFA step-up before proceeding —
 * true only when the account has a verified factor (`nextLevel==='aal2'`)
 * that this session hasn't satisfied yet (`currentLevel!==nextLevel`).
 * For every account without MFA enrolled, `nextLevel` stays `'aal1'` and
 * this is always false — zero behavior change until a user opts in.
 *
 * Works with both the server (`lib/supabase/server.ts`) and browser
 * (`lib/supabase/client.ts`) Supabase clients — same GoTrueClient API on
 * both, just bound to a different session source.
 */
export async function needsMfaStepUp(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.nextLevel === "aal2" && data.currentLevel !== data.nextLevel;
  } catch {
    return false;
  }
}
