/**
 * Extracts the `session_id` claim from an already-verified Supabase access
 * token, so we can tell which of a user's `auth.sessions` rows corresponds to
 * the device making the current request ("this device" in the sessions UI).
 * No signature check here — only ever call this on a token that
 * getSessionUser()/auth.getUser() has already validated.
 */
export function decodeSessionId(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { session_id?: string };
    return claims.session_id ?? null;
  } catch {
    return null;
  }
}
