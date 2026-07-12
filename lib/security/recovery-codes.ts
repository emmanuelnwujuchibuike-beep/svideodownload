import { createHmac, randomInt } from "node:crypto";

/**
 * MFA recovery codes (migration 0057). Hashed with HMAC-SHA256 + a server
 * pepper rather than bcrypt/scrypt — these are already high-entropy random
 * tokens, not low-entropy passwords, so slow hashing buys nothing. If
 * RECOVERY_CODE_PEPPER is ever rotated, every outstanding code silently
 * stops working — treat it like SUPABASE_SERVICE_ROLE_KEY: set once, don't
 * rotate casually.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

function randomGroup(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Generates 10 codes shaped XXXX-XXXX-XXXX, shown to the user exactly once. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`);
}

export function hashRecoveryCode(code: string): string {
  const pepper = process.env.RECOVERY_CODE_PEPPER;
  if (!pepper) throw new Error("RECOVERY_CODE_PEPPER is not set");
  return createHmac("sha256", pepper).update(code.trim().toUpperCase()).digest("hex");
}
