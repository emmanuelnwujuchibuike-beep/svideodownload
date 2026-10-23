import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * 🔴 RESET THE ADMIN PASSWORD WITH AN EMAILED CODE, FROM INSIDE THE DASHBOARD (owner, 2026-10-23: "I tried
 * changing my paystack live secret from my admin dashboard but seems I forgot the password, make to be able to
 * reset my admin password from dashboard and they send a code to my admin email to verify and change the
 * password"), and the same for members who signed in with a password (owner, same day: "Make users use same
 * forgot password pattern to change password if they sign in with password instead of sign in code").
 *
 * Stateless, like the re-auth marker (reauth.ts): the six-digit code is never stored. An HttpOnly cookie holds
 * `userId.expiry.HMAC(userId.expiry.code)`, so the code is proved by recomputing the MAC, and a cookie earned by
 * one administrator is inert in another's session. Guessing is bounded by the login throttle the routes share
 * with the login form; the MAC key is the re-auth secret with its own label, so a re-auth MAC can never pass here.
 * Fails closed: no secret, no cookie, a bad MAC, another user or an expired code all answer false.
 */

/** Who the code is for: each has its own cookie and its own MAC label, so a member's code never works for /admin. */
export type PasswordCodePurpose = "admin" | "member";
const COOKIE: Record<PasswordCodePurpose, string> = { admin: "frenz_admin_pwcode", member: "frenz_pwcode" };
const TTL_MINUTES = 10;

function secret(purpose: PasswordCodePurpose): string | null {
  const s = process.env.ADMIN_REAUTH_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return s ? `${purpose}-password-code:${s}` : null;
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export const PASSWORD_CODE_TTL_MINUTES = TTL_MINUTES;

/** A fresh six-digit code for this administrator, armed in the cookie. Null when no secret is configured. */
export async function issuePasswordCode(userId: string, purpose: PasswordCodePurpose): Promise<string | null> {
  const key = secret(purpose);
  if (!key) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiry = Date.now() + TTL_MINUTES * 60_000;
  const jar = await cookies();
  jar.set(COOKIE[purpose], `${userId}.${expiry}.${mac(`${userId}.${expiry}.${code}`, key)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MINUTES * 60,
  });
  return code;
}

/** Is `code` the one emailed to this administrator, and still in time? */
export async function checkPasswordCode(userId: string, code: string, purpose: PasswordCodePurpose): Promise<boolean> {
  const key = secret(purpose);
  if (!key || !/^\d{6}$/.test(code)) return false;
  const raw = (await cookies()).get(COOKIE[purpose])?.value;
  const parts = raw?.split(".") ?? [];
  if (parts.length !== 3) return false;
  const [id, expiryRaw, got] = parts as [string, string, string];
  const a = Buffer.from(got);
  const b = Buffer.from(mac(`${id}.${expiryRaw}.${code}`, key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiry = Number(expiryRaw);
  return id === userId && Number.isFinite(expiry) && expiry > Date.now();
}

/** Spent once the password changes, so the code cannot be used twice. */
export async function clearPasswordCode(purpose: PasswordCodePurpose): Promise<void> {
  (await cookies()).delete(COOKIE[purpose]);
}

/**
 * How THIS session signed in, from the access token's `amr` claim (the newest entry): "password", "otp",
 * "oauth", … Null when it cannot be read. Only call on a token Supabase has already validated.
 */
export function signInMethod(accessToken: string | null): string | null {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return null;
    const { amr } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { amr?: { method?: string; timestamp?: number }[] };
    const newest = [...(amr ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    return newest?.method ?? null;
  } catch {
    return null;
  }
}

/** A member password's floor — the same as the editor (features/account/password-editor.tsx). */
export const MIN_MEMBER_PASSWORD_LENGTH = 8;

/**
 * Whether changing the password needs an emailed code: yes when THIS session signed in with a password (owner,
 * 2026-10-23: "Make users use same forgot password pattern to change password if they sign in with password
 * instead of sign in code"), and when the method cannot be read (fails closed). A session opened with an email
 * code, including the "Forgot password?" flow, already proved the inbox.
 */
export function passwordChangeNeedsCode(method: string | null): boolean {
  return method === null || method === "password";
}

/** "e•••l@gmail.com" — enough for the admin to recognise the inbox, not a full address on screen. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  if (!domain) return "your admin email";
  const shown = user.length <= 2 ? user.slice(0, 1) : `${user.slice(0, 1)}•••${user.slice(-1)}`;
  return `${shown}@${domain}`;
}
