import "server-only";

import { createHmac, randomBytes, scrypt as scryptCb, type ScryptOptions } from "node:crypto";
import { cookies } from "next/headers";

import { validateAdminPassword } from "@/lib/admin/password-policy";
import { pinProblem } from "@/lib/coin/pin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADMIN DASHBOARD LOCK (migration 0301, owner 2026-10-28)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * After the ordinary sign-in, an administrator enters the DASHBOARD PASSWORD (its own, not the account password) and
 * then a 6-digit PIN. Until both pass in this browser, every admin page shows the lock screen and every admin API
 * answers 423 — lib/admin/require-admin.ts asks `adminLockStage` on every request.
 *
 * Hashing is the coin PIN's (lib/coin/pin.ts): scrypt(HMAC-SHA256(pepper, label + user + secret), salt), compared IN the
 * database (the hashes are readable by no API role). The pepper is `ADMIN_LOCK_PEPPER`, else `FRENZ_COIN_PIN_PEPPER`
 * (already set where coins run) — the label keeps the two uses apart. No pepper = nothing unlocks (fail closed).
 *
 * The browser holds `frenz_admin_lock = <session id>.<32 random bytes>`; the database holds only HMAC(pepper, token).
 * HttpOnly, SameSite=Strict, Secure in production. The session lives 10 minutes at the password stage and 8 hours once
 * unlocked; a lockout or a PIN reset ends every session of that admin.
 */

const COOKIE = "frenz_admin_lock";
const KEYLEN = 32;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;

type Params = { algorithm: "scrypt"; N: number; r: number; p: number; keylen: number; pepper: string };
export type LockStage = "unlocked" | "password" | "none";
export type LockResult = { ok: true } | { ok: false; status: number; reason: string; error: string };

const fail = (status: number, reason: string, error: string): LockResult => ({ ok: false, status, reason, error });
const UNAVAILABLE = fail(503, "unavailable", "The admin lock isn't available. Check that migration 0301 has run and ADMIN_LOCK_PEPPER is set.");
const REFUSED = fail(403, "authorization_failed", "That wasn't accepted. Check it and try again. Too many tries lock the dashboard for a while.");

/**
 * 🔴 Set it once and never change it: a different pepper makes every stored password and PIN unmatchable (the admins
 * would need the setup link again after an operator clears admin_lock_credentials).
 */
export function lockPepper(): string | null {
  const p = (process.env.ADMIN_LOCK_PEPPER?.trim() || process.env.FRENZ_COIN_PIN_PEPPER?.trim() || "");
  return p.length >= 32 ? p : null;
}

function scrypt(password: Buffer, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

async function deriveKey(kind: "password" | "pin", secret: string, salt: Buffer, userId: string, params: Pick<Params, "N" | "r" | "p" | "keylen">, pepper: string): Promise<Buffer> {
  const peppered = createHmac("sha256", pepper).update(`frenz-admin-lock:${kind}:${userId}:${secret}`).digest();
  return scrypt(peppered, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 });
}

const PARAMS: Params = { algorithm: "scrypt", ...SCRYPT, keylen: KEYLEN, pepper: "v1" };

async function newHash(kind: "password" | "pin", secret: string, userId: string, pepper: string) {
  const salt = randomBytes(16);
  return { hash: await deriveKey(kind, secret, salt, userId, PARAMS, pepper), salt };
}

const hex = (b: Buffer) => `\\x${b.toString("hex")}`;
const tokenHash = (kind: string, userId: string, token: string, pepper: string) =>
  createHmac("sha256", pepper).update(`frenz-admin-lock-${kind}:${userId}:${token}`).digest();

/** A dashboard password: the admin sign-in's own policy (12+ characters, not a common password). The server decides. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string") return "Enter a password.";
  const v = validateAdminPassword(pw);
  return v.ok ? null : (v.reason ?? "Choose a stronger password.");
}

function pinError(pin: unknown): string | null {
  const p = pinProblem(pin);
  return p === "format" ? "The PIN is exactly 6 digits." : p === "too_simple" ? "Choose a PIN that isn't one digit repeated or a straight run." : null;
}

// ── the cookie ────────────────────────────────────────────────────────────────

async function readCookie(): Promise<{ session: string; token: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  return m ? { session: m[1]!, token: m[2]! } : null;
}

async function writeCookie(session: string, token: string, maxAge: number) {
  (await cookies()).set(COOKIE, `${session}.${token}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearLockCookie() {
  (await cookies()).delete(COOKIE);
}

// ── reads ─────────────────────────────────────────────────────────────────────

/** This browser's stage for this admin. Any error = "none" (fail closed). */
export async function adminLockStage(userId: string): Promise<LockStage> {
  const pepper = lockPepper();
  const c = await readCookie();
  if (!pepper || !c) return "none";
  const { data, error } = await createAdminClient().rpc("admin_lock_session_stage", { p_user: userId, p_session: c.session, p_token_hash: hex(tokenHash("session", userId, c.token, pepper)) });
  if (error) return "none";
  return data === "unlocked" ? "unlocked" : data === "password" ? "password" : "none";
}

/** What is set (never a hash). null = the lock can't be read (migration not run, database down). */
export async function adminLockStatus(userId: string): Promise<{ set: boolean; hasPrevious: boolean; lockedUntil: string | null } | null> {
  const { data, error } = await createAdminClient().rpc("admin_lock_status", { p_user: userId });
  if (error) return null;
  const r = (data ?? {}) as { set?: boolean; has_previous?: boolean; locked_until?: string | null };
  return { set: !!r.set, hasPrevious: !!r.has_previous, lockedUntil: r.locked_until ?? null };
}

// ── a counted attempt ─────────────────────────────────────────────────────────

type Begun = { attemptId: string; params: Params; passwordSalt: Buffer; prevPasswordSalt: Buffer | null; pinSalt: Buffer };

async function begin(userId: string, purpose: "password" | "pin" | "pin_reset" | "change_password" | "fund"): Promise<Begun | "refused" | "unavailable"> {
  const { data, error } = await createAdminClient().rpc("admin_lock_begin", { p_user: userId, p_purpose: purpose });
  if (error) return "unavailable";
  const r = (data ?? {}) as { ok?: boolean; attempt_id?: string; params?: Partial<Params>; password_salt?: string; prev_password_salt?: string | null; pin_salt?: string };
  if (!r.ok || !r.attempt_id || !r.params || !r.password_salt || !r.pin_salt) return "refused";
  const p = r.params;
  if (p.algorithm !== "scrypt" || !Number.isSafeInteger(p.N) || !Number.isSafeInteger(p.r) || !Number.isSafeInteger(p.p) || !Number.isSafeInteger(p.keylen)) return "unavailable";
  return {
    attemptId: r.attempt_id,
    params: p as Params,
    passwordSalt: Buffer.from(r.password_salt, "hex"),
    prevPasswordSalt: r.prev_password_salt ? Buffer.from(r.prev_password_salt, "hex") : null,
    pinSalt: Buffer.from(r.pin_salt, "hex"),
  };
}

// ── step 1 and step 2 ─────────────────────────────────────────────────────────

export async function checkDashboardPassword(userId: string, password: unknown): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  if (typeof password !== "string" || !password || password.length > 200) return REFUSED;
  const b = await begin(userId, "password");
  if (b === "unavailable") return UNAVAILABLE;
  if (b === "refused") return REFUSED;
  const key = await deriveKey("password", password, b.passwordSalt, userId, b.params, pepper);
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await createAdminClient().rpc("admin_lock_check_password", { p_user: userId, p_attempt: b.attemptId, p_key: hex(key), p_token_hash: hex(tokenHash("session", userId, token, pepper)) });
  if (error) return UNAVAILABLE;
  const r = (data ?? {}) as { ok?: boolean; session_id?: string };
  if (!r.ok || !r.session_id) return REFUSED;
  await writeCookie(r.session_id, token, 10 * 60);
  return { ok: true };
}

export async function checkDashboardPin(userId: string, pin: unknown): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  const c = await readCookie();
  if (!c) return fail(409, "session", "Enter the dashboard password first.");
  if (pinProblem(pin) === "format") return REFUSED;
  const b = await begin(userId, "pin");
  if (b === "unavailable") return UNAVAILABLE;
  if (b === "refused") return REFUSED;
  const key = await deriveKey("pin", pin as string, b.pinSalt, userId, b.params, pepper);
  const { data, error } = await createAdminClient().rpc("admin_lock_check_pin", { p_user: userId, p_attempt: b.attemptId, p_key: hex(key), p_session: c.session, p_token_hash: hex(tokenHash("session", userId, c.token, pepper)) });
  if (error) return UNAVAILABLE;
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.reason === "session") return fail(409, "session", "That took too long. Enter the dashboard password again.");
  if (!r.ok) return REFUSED;
  await writeCookie(c.session, c.token, 8 * 60 * 60);
  return { ok: true };
}

/** "Lock now" and sign-out: end this browser's session. */
export async function endAdminLockSession(userId: string): Promise<void> {
  const c = await readCookie();
  if (c) await createAdminClient().rpc("admin_lock_end_session", { p_user: userId, p_session: c.session });
  await clearLockCookie();
}

// ── emailed links ─────────────────────────────────────────────────────────────

type Send = (url: string, minutes: number) => Promise<boolean>;

function linkUrl(origin: string, purpose: "setup" | "pin_reset", token: string) {
  return `${origin}/admin/unlock/${purpose === "setup" ? "setup" : "new-pin"}?t=${encodeURIComponent(token)}`;
}

/** First setup: an emailed link, only while nothing is set. Always the same answer to the caller. */
export async function requestSetupLink(userId: string, origin: string, send: Send): Promise<{ ok: boolean }> {
  const pepper = lockPepper();
  if (!pepper) return { ok: false };
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await createAdminClient().rpc("admin_lock_issue_link", { p_user: userId, p_purpose: "setup", p_token_hash: hex(tokenHash("link-setup", userId, token, pepper)) });
  if (error) return { ok: false };
  const r = (data ?? {}) as { issued?: boolean; expires_minutes?: number };
  if (r.issued && !(await send(linkUrl(origin, "setup", token), Number(r.expires_minutes ?? 30)).catch(() => false))) console.error("[admin/lock] setup email not accepted", { userId });
  return { ok: true };
}

/** Is this emailed link live for this admin? Opening the email checks it; no use is spent. */
export async function linkIsValid(userId: string, purpose: "setup" | "pin_reset", token: unknown): Promise<boolean> {
  const pepper = lockPepper();
  if (!pepper || typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const { data, error } = await createAdminClient().rpc("admin_lock_link_valid", { p_user: userId, p_purpose: purpose, p_token_hash: hex(tokenHash(`link-${purpose === "setup" ? "setup" : "pin_reset"}`, userId, token, pepper)) });
  return !error && data === true;
}

/** First setup through the link: the dashboard password and the PIN, each typed twice. */
export async function completeSetup(userId: string, token: unknown, password: unknown, password2: unknown, pin: unknown, pin2: unknown): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  const pw = passwordProblem(password);
  if (pw) return fail(400, "password", pw);
  if (password !== password2) return fail(400, "mismatch", "The two passwords don't match.");
  const pe = pinError(pin);
  if (pe) return fail(400, "pin", pe);
  if (pin !== pin2) return fail(400, "mismatch", "The two PINs don't match.");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(400, "link", "This link isn't valid any more. Ask for a new one.");
  const p = await newHash("password", password as string, userId, pepper);
  const n = await newHash("pin", pin as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("admin_lock_setup", {
    p_user: userId,
    p_link_hash: hex(tokenHash("link-setup", userId, token, pepper)),
    p_password_hash: hex(p.hash),
    p_password_salt: hex(p.salt),
    p_pin_hash: hex(n.hash),
    p_pin_salt: hex(n.salt),
    p_params: PARAMS,
  });
  if (error) return UNAVAILABLE;
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.ok) return { ok: true };
  if (r.reason === "exists") return fail(409, "exists", "The lock is already set up.");
  return fail(400, "link", "This link isn't valid any more. Ask for a new one.");
}

/**
 * PIN reset step 1: the current dashboard password and the previous one — or, if there has never been a previous one,
 * the current one typed twice. Only then is a link emailed (one counted attempt either way).
 */
export async function requestPinReset(userId: string, current: unknown, previous: unknown, origin: string, send: Send): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  if (typeof current !== "string" || typeof previous !== "string" || !current || !previous || current.length > 200 || previous.length > 200) return REFUSED;
  const b = await begin(userId, "pin_reset");
  if (b === "unavailable") return UNAVAILABLE;
  if (b === "refused") return REFUSED;
  const k1 = await deriveKey("password", current, b.passwordSalt, userId, b.params, pepper);
  // no previous password on record: the second box must be the current password again (checked against it)
  const k2 = await deriveKey("password", previous, b.prevPasswordSalt ?? b.passwordSalt, userId, b.params, pepper);
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await createAdminClient().rpc("admin_lock_request_pin_reset", {
    p_user: userId,
    p_attempt: b.attemptId,
    p_current: hex(k1),
    p_previous: hex(k2),
    p_link_hash: hex(tokenHash("link-pin_reset", userId, token, pepper)),
  });
  if (error) return UNAVAILABLE;
  const r = (data ?? {}) as { ok?: boolean; issued?: boolean; expires_minutes?: number };
  if (!r.ok) return REFUSED;
  if (r.issued && !(await send(linkUrl(origin, "pin_reset", token), Number(r.expires_minutes ?? 30)).catch(() => false))) console.error("[admin/lock] reset email not accepted", { userId });
  return { ok: true };
}

/** PIN reset step 2, from the emailed link: the new PIN, typed twice. Ends every dashboard session of this admin. */
export async function completePinReset(userId: string, token: unknown, pin: unknown, pin2: unknown): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  const pe = pinError(pin);
  if (pe) return fail(400, "pin", pe);
  if (pin !== pin2) return fail(400, "mismatch", "The two PINs don't match.");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(400, "link", "This link isn't valid any more. Ask for a new one.");
  const n = await newHash("pin", pin as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("admin_lock_complete_pin_reset", { p_user: userId, p_link_hash: hex(tokenHash("link-pin_reset", userId, token, pepper)), p_pin_hash: hex(n.hash), p_pin_salt: hex(n.salt) });
  if (error) return UNAVAILABLE;
  if (!(data as { ok?: boolean } | null)?.ok) return fail(400, "link", "This link isn't valid any more. Ask for a new one.");
  await clearLockCookie();
  return { ok: true };
}

/** Change the dashboard password (the current one, then the new one twice). The old one becomes the "previous". */
export async function changeDashboardPassword(userId: string, current: unknown, next: unknown, next2: unknown): Promise<LockResult> {
  const pepper = lockPepper();
  if (!pepper) return UNAVAILABLE;
  const pw = passwordProblem(next);
  if (pw) return fail(400, "password", pw);
  if (next !== next2) return fail(400, "mismatch", "The two new passwords don't match.");
  if (next === current) return fail(400, "same", "Choose a password you haven't just used.");
  if (typeof current !== "string" || !current || current.length > 200) return REFUSED;
  const b = await begin(userId, "change_password");
  if (b === "unavailable") return UNAVAILABLE;
  if (b === "refused") return REFUSED;
  const key = await deriveKey("password", current, b.passwordSalt, userId, b.params, pepper);
  const h = await newHash("password", next as string, userId, pepper);
  const { data, error } = await createAdminClient().rpc("admin_lock_change_password", { p_user: userId, p_attempt: b.attemptId, p_current: hex(key), p_hash: hex(h.hash), p_salt: hex(h.salt) });
  if (error) return UNAVAILABLE;
  return (data as { ok?: boolean } | null)?.ok ? { ok: true } : REFUSED;
}

// ── manual Frenz Coin funding ─────────────────────────────────────────────────

export type FundResult =
  | { ok: true; fundingId: string; duplicate: boolean }
  | { ok: false; status: number; reason: string; error: string };

const FUND_ERRORS: Record<string, [number, string]> = {
  invalid: [400, "Check the amount (up to $1,000), a reason of 5 to 200 characters, and try again."],
  locked: [423, "The dashboard is locked. Unlock it and try again."],
  authorization_failed: [403, "That PIN wasn't accepted."],
  no_recipient: [404, "No wallet has that number."],
  self: [400, "You can't fund your own wallet."],
  daily_cap: [429, "That would pass the $5,000 you can fund in 24 hours."],
  idempotency_conflict: [409, "This funding was already sent with different details. Start a new one."],
};

/** Fund a wallet: an unlocked session in this browser + a fresh PIN entry, in one database transaction. */
export async function fundCoinWallet(adminId: string, input: { pin: unknown; accountNumber: unknown; amountCents: unknown; reason: unknown; reference: unknown }): Promise<FundResult> {
  const pepper = lockPepper();
  const err = (reason: string): FundResult => {
    const [status, error] = FUND_ERRORS[reason] ?? [503, "The funding couldn't be made. Nothing was credited."];
    return { ok: false, status, reason, error };
  };
  if (!pepper) return err("unavailable");
  const c = await readCookie();
  if (!c) return err("locked");
  const { pin, accountNumber, amountCents, reason, reference } = input;
  if (typeof accountNumber !== "string" || !/^[0-9]{10}$/.test(accountNumber)) return err("no_recipient");
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100_000) return err("invalid");
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 200) return err("invalid");
  if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(reference)) return err("invalid");
  if (pinProblem(pin) === "format") return err("authorization_failed");
  const b = await begin(adminId, "fund");
  if (b === "unavailable") return err("unavailable");
  if (b === "refused") return err("authorization_failed");
  const key = await deriveKey("pin", pin as string, b.pinSalt, adminId, b.params, pepper);
  const { data, error } = await createAdminClient().rpc("admin_fund_coin_wallet", {
    p_admin: adminId,
    p_session: c.session,
    p_token_hash: hex(tokenHash("session", adminId, c.token, pepper)),
    p_attempt: b.attemptId,
    p_pin_key: hex(key),
    p_account_number: accountNumber,
    p_amount: amountCents,
    p_reason: reason.trim(),
    p_reference: reference,
  });
  if (error) return err("unavailable");
  const r = (data ?? {}) as { ok?: boolean; reason?: string; funding_id?: string; duplicate?: boolean };
  if (r.ok && r.funding_id) return { ok: true, fundingId: r.funding_id, duplicate: !!r.duplicate };
  return err(r.reason ?? "unavailable");
}
