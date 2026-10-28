import "server-only";

import { createHmac, randomBytes, randomInt, scrypt as scryptCb, type ScryptOptions } from "node:crypto";

import type { FrenzCoinConfig } from "@/lib/coin/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN — THE TRANSACTION PIN (Frenz Coin Part 4.2, migration 0282)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Six digits, the member's own, for money only — NEVER the messaging quick-lock PIN (lib/security/pin.ts, 0056).
 *
 * ── Why this is safe for a six-digit secret ─────────────────────────────────
 * A million possible PINs cannot be protected by the hash alone: anyone holding the hash and enough time tries them all.
 * Three layers do it together:
 *   1. ONLINE the database counts every attempt BEFORE it is checked (begin_coin_pin_attempt) and locks after a few
 *      (5 by default) for 15 minutes, doubling each time, capped at 24 hours — never permanently. That is a few dozen
 *      guesses a day at most: decades to cover even half the space. Parallel requests cannot exceed the count.
 *   2. OFFLINE the stored hash is scrypt(HMAC-SHA256(PEPPER, pin), per-PIN salt). The pepper is a server secret
 *      (FRENZ_COIN_PIN_PEPPER) that is never in the database: a copy of the tables alone is not enough to test PINs.
 *   3. scrypt (memory-hard, Node's own implementation, no new dependency; N = 2^15, r = 8, p = 1, 32 bytes) makes each
 *      offline guess expensive even with the pepper. Argon2id would need a new native dependency; scrypt is the memory-hard
 *      function the platform already ships and the quick-lock PIN already uses. Parameters are stored with each hash,
 *      so they can be raised later without invalidating existing PINs.
 * The comparison happens IN the database: the hash never leaves it, and is not readable by any API role (0282).
 *
 * No pepper configured = no PIN can be set, checked or reset: transfers fail closed.
 */

export const PIN_LENGTH = 6;
const KEYLEN = 32;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;
const PEPPER_VERSION = "v1";

export interface PinParams {
  algorithm: "scrypt";
  N: number;
  r: number;
  p: number;
  keylen: number;
  pepper: string;
}

/** The server secret, or null (then nothing about PINs works — fail closed). Never logged. */
export function pinPepper(): string | null {
  const p = (process.env.FRENZ_COIN_PIN_PEPPER ?? "").trim();
  return p.length >= 32 ? p : null;
}

/**
 * Six digits, and not one an attacker tries first: all the same digit, or a straight run up or down (123456, 987654).
 * The server decides; the browser's check is only a convenience.
 */
export function pinProblem(pin: unknown): "format" | "too_simple" | null {
  if (typeof pin !== "string" || !/^[0-9]{6}$/.test(pin)) return "format";
  if (/^(\d)\1{5}$/.test(pin)) return "too_simple";
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => (x - d[i]! + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return "too_simple";
  return null;
}

function scrypt(password: Buffer, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** The key the database compares: scrypt(HMAC-SHA256(pepper, "frenz-coin-pin:" + user + ":" + pin), salt). */
export async function derivePinKey(pin: string, salt: Buffer, userId: string, params: Pick<PinParams, "N" | "r" | "p" | "keylen">, pepper: string): Promise<Buffer> {
  const peppered = createHmac("sha256", pepper).update(`frenz-coin-pin:${userId}:${pin}`).digest();
  return scrypt(peppered, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 });
}

/** A new hash for a new PIN: a fresh 16-byte salt and the current parameters. */
export async function hashNewPin(pin: string, userId: string, pepper: string): Promise<{ hash: Buffer; salt: Buffer; params: PinParams }> {
  const salt = randomBytes(16);
  const params: PinParams = { algorithm: "scrypt", ...SCRYPT, keylen: KEYLEN, pepper: PEPPER_VERSION };
  return { hash: await derivePinKey(pin, salt, userId, params, pepper), salt, params };
}

/** An eight-digit reset code from the CSPRNG, and the only thing stored about it: HMAC(pepper, user + code). */
export function newResetCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}
export function resetCodeHash(code: string, userId: string, pepper: string): Buffer {
  return createHmac("sha256", pepper).update(`frenz-coin-pin-reset:${userId}:${code}`).digest();
}

/** Postgres bytea literal for PostgREST (hex). */
export const hex = (b: Buffer) => `\\x${b.toString("hex")}`;

/** The policy handed to the database (it clamps every number again). */
export const pinPolicy = (c: FrenzCoinConfig) => ({ ...c.pin });

const MISSING = (m: string) => /coin_pin|set_coin_pin|change_coin_pin|transfer_coins_with_pin|schema cache|does not exist/i.test(m);

export type PinResult = { ok: true } | { ok: false; status: number; reason: string; error: string };
const fail = (status: number, reason: string, error: string): PinResult => ({ ok: false, status, reason, error });
const UNAVAILABLE = fail(503, "unavailable", "Transaction PINs aren't available right now.");
const NOT_ACCEPTED = fail(403, "authorization_failed", "That PIN wasn't accepted. Check it, or try again later.");

/** The member's own PIN state: set, and locked until when (never the hash). null = could not be read. */
export async function coinPinStatus(userId: string): Promise<{ set: boolean; lockedUntil: string | null } | null> {
  const { data, error } = await createAdminClient().rpc("coin_pin_status", { p_user: userId });
  if (error) return null;
  const r = (data ?? {}) as { set?: boolean; locked_until?: string | null };
  return { set: !!r.set, lockedUntil: r.locked_until ?? null };
}

/** First-time setup: six digits, typed twice, never replacing an existing PIN. */
export async function setCoinPin(userId: string, pin: unknown, confirm: unknown): Promise<PinResult> {
  const pepper = pinPepper();
  if (!pepper) return UNAVAILABLE;
  const problem = pinProblem(pin);
  if (problem) return fail(400, problem, problem === "format" ? "A transaction PIN is exactly 6 digits." : "Choose a PIN that isn't one digit repeated or a straight run.");
  if (pin !== confirm) return fail(400, "mismatch", "The two PINs don't match.");
  const h = await hashNewPin(pin as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("set_coin_pin", { p_user: userId, p_hash: hex(h.hash), p_salt: hex(h.salt), p_params: h.params });
  if (error) {
    if (!MISSING(error.message)) console.error("[coin/pin] set failed", { code: error.code });
    return UNAVAILABLE;
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.ok) return { ok: true };
  if (r.reason === "exists") return fail(409, "exists", "You already have a transaction PIN. Change it or reset it instead.");
  if (r.reason === "email_unconfirmed") return fail(403, "email_unconfirmed", "Confirm your email address before setting a transaction PIN.");
  if (r.reason === "suspended") return fail(403, "suspended", "This account can't set a transaction PIN right now.");
  return fail(400, "invalid", "That request isn't valid.");
}

/**
 * Begin a counted PIN entry and derive the key for it. The attempt is spent by whichever function checks it.
 * Any refusal (no PIN, locked, the database unavailable) is the same answer to the caller.
 */
export async function beginPinProof(userId: string, pin: unknown, purpose: "transfer" | "change" | "withdrawal" | "gift", config: FrenzCoinConfig): Promise<{ ok: true; attemptId: string; key: Buffer } | { ok: false; reason: "authorization_failed" | "unavailable" }> {
  const pepper = pinPepper();
  if (!pepper) return { ok: false, reason: "unavailable" };
  // a malformed PIN is never sent to the database (and never counted): it cannot be anyone's PIN
  if (pinProblem(pin) === "format") return { ok: false, reason: "authorization_failed" };
  const { data, error } = await createAdminClient().rpc("begin_coin_pin_attempt", { p_user: userId, p_purpose: purpose, p_policy: pinPolicy(config) });
  if (error) {
    if (!MISSING(error.message)) console.error("[coin/pin] begin failed", { code: error.code });
    return { ok: false, reason: "unavailable" };
  }
  const r = (data ?? {}) as { ok?: boolean; attempt_id?: string; salt?: string; params?: Partial<PinParams> };
  if (!r.ok || !r.attempt_id || !r.salt || !r.params) return { ok: false, reason: "authorization_failed" };
  const p = r.params;
  if (p.algorithm !== "scrypt" || !Number.isSafeInteger(p.N) || !Number.isSafeInteger(p.r) || !Number.isSafeInteger(p.p) || !Number.isSafeInteger(p.keylen)) return { ok: false, reason: "unavailable" };
  const key = await derivePinKey(pin as string, Buffer.from(r.salt, "hex"), userId, { N: p.N!, r: p.r!, p: p.p!, keylen: p.keylen! }, pepper);
  return { ok: true, attemptId: r.attempt_id, key };
}

/** Change the PIN: the current PIN (a counted attempt), then the new one — one database transaction. */
export async function changeCoinPin(userId: string, current: unknown, next: unknown, confirm: unknown, config: FrenzCoinConfig): Promise<PinResult> {
  const pepper = pinPepper();
  if (!pepper) return UNAVAILABLE;
  const problem = pinProblem(next);
  if (problem) return fail(400, problem, problem === "format" ? "A transaction PIN is exactly 6 digits." : "Choose a PIN that isn't one digit repeated or a straight run.");
  if (next !== confirm) return fail(400, "mismatch", "The two new PINs don't match.");
  const proof = await beginPinProof(userId, current, "change", config);
  if (!proof.ok) return proof.reason === "unavailable" ? UNAVAILABLE : NOT_ACCEPTED;
  const h = await hashNewPin(next as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("change_coin_pin", { p_user: userId, p_attempt: proof.attemptId, p_current: hex(proof.key), p_hash: hex(h.hash), p_salt: hex(h.salt), p_params: h.params, p_policy: pinPolicy(config) });
  if (error) return UNAVAILABLE;
  return (data as { ok?: boolean } | null)?.ok ? { ok: true } : NOT_ACCEPTED;
}

/**
 * Ask for a reset code. ALWAYS the same answer to the caller — whether a code was issued, the member has a PIN, or a
 * limit was hit is never said. `send` is called only when the database issued a code.
 */
export async function requestCoinPinReset(userId: string, config: FrenzCoinConfig, send: (code: string, minutes: number) => Promise<boolean>): Promise<{ ok: true } | { ok: false; status: 503 }> {
  const pepper = pinPepper();
  if (!pepper) return { ok: false, status: 503 };
  const code = newResetCode();
  const { data, error } = await createAdminClient().rpc("request_coin_pin_reset", { p_user: userId, p_code_hash: hex(resetCodeHash(code, userId, pepper)), p_policy: pinPolicy(config) });
  if (error) {
    if (!MISSING(error.message)) console.error("[coin/pin] reset request failed", { code: error.code });
    return { ok: false, status: 503 };
  }
  const r = (data ?? {}) as { issued?: boolean; expires_minutes?: number };
  if (r.issued) {
    const sent = await send(code, Number(r.expires_minutes ?? 10)).catch(() => false);
    if (!sent) console.error("[coin/pin] reset email not accepted", { userId });
  }
  return { ok: true };
}

/** Complete a reset with the emailed code and a new PIN (typed twice). Wrong, used, old or replaced codes: one answer. */
export async function completeCoinPinReset(userId: string, code: unknown, next: unknown, confirm: unknown, config: FrenzCoinConfig): Promise<PinResult> {
  const pepper = pinPepper();
  if (!pepper) return UNAVAILABLE;
  const problem = pinProblem(next);
  if (problem) return fail(400, problem, problem === "format" ? "A transaction PIN is exactly 6 digits." : "Choose a PIN that isn't one digit repeated or a straight run.");
  if (next !== confirm) return fail(400, "mismatch", "The two new PINs don't match.");
  const invalid = fail(400, "invalid_code", "That code isn't valid. Ask for a new one.");
  if (typeof code !== "string" || !/^[0-9]{8}$/.test(code)) return invalid;
  const h = await hashNewPin(next as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("complete_coin_pin_reset", { p_user: userId, p_code_hash: hex(resetCodeHash(code, userId, pepper)), p_hash: hex(h.hash), p_salt: hex(h.salt), p_params: h.params, p_policy: pinPolicy(config) });
  if (error) return UNAVAILABLE;
  return (data as { ok?: boolean } | null)?.ok ? { ok: true } : invalid;
}
