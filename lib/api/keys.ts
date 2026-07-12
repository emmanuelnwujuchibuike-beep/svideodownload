import { createHash, randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * API key management. Keys are shown to the user **once** at creation and only
 * their SHA-256 hash is stored — we can verify but never reveal them again.
 * Format: `svd_live_<43 url-safe chars>`.
 */

const PREFIX = "svd_live_";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateRawKey(): { raw: string; hash: string; prefix: string } {
  const raw = PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 16) };
}

export interface ApiKeyAuth {
  keyId: string;
  userId: string;
}

/** Resolves a raw API key to its owner, or null if invalid/revoked. */
export async function verifyApiKey(raw: string | null | undefined): Promise<ApiKeyAuth | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("api_keys")
      .select("id, user_id, revoked")
      .eq("key_hash", hashKey(raw))
      .maybeSingle();
    if (!data || data.revoked) return null;
    // `.then()` is load-bearing — Supabase's query builder is a lazy
    // thenable; a bare `void` with no `.then()`/`await` anywhere in the
    // chain never actually sends the request. This UPDATE had silently
    // never been firing, so `last_used` never advanced past its initial value.
    supabase
      .from("api_keys")
      .update({ last_used: new Date().toISOString() })
      .eq("id", data.id)
      .then(undefined, () => {});
    return { keyId: data.id as string, userId: data.user_id as string };
  } catch {
    return null;
  }
}

/** Extracts the bearer token from a request's Authorization header. */
export function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization") || request.headers.get("x-api-key");
  if (!h) return null;
  return h.startsWith("Bearer ") ? h.slice(7).trim() : h.trim();
}
