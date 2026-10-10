import { normalizeEmail } from "./normalize";

/**
 * SHA-256 (lower-case hex) of a normalised address, computed in the browser
 * with Web Crypto. This hash, never the address, is what leaves the device.
 * The database keys it again with a secret before any lookup (migration 0220).
 */
export async function hashEmail(address: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(address));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
