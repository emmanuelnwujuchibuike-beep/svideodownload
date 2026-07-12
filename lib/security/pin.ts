import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** App-level quick-lock PIN hashing (migration 0056, service-role-only table). */

const KEY_LENGTH = 64;

export function hashPin(pin: string): { hash: Buffer; salt: Buffer } {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH);
  return { hash, salt };
}

export function verifyPin(pin: string, hash: Buffer, salt: Buffer): boolean {
  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  // Buffers must be equal length for timingSafeEqual — a mismatched stored
  // hash (shouldn't happen, but defensively) must fail closed, not throw.
  if (candidate.length !== hash.length) return false;
  return timingSafeEqual(candidate, hash);
}
