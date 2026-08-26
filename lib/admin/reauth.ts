import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RECENT-RE-AUTHENTICATION MARKER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "This administrator proved they know the password, less than N minutes ago."
 * Sensitive server actions require it in addition to a valid admin session.
 *
 * ── 🔴 THIS IS NOT A SESSION TIMEOUT ──────────────────────────────────────
 *
 * Requirement 3 forbids an inactivity timeout, and this is not one: the admin
 * SESSION stays valid for as long as Supabase says it is, and nothing here ever
 * signs anybody out. This marker gates a handful of destructive operations and
 * nothing else. Letting it lapse costs one password prompt at the moment of a
 * dangerous action, never a lost session or a re-login to keep browsing.
 *
 * ── What the cookie contains, and what it cannot do ───────────────────────
 *
 * `<userId>.<expiryMs>.<hmac>` — an identifier and a timestamp, signed. There is
 * no credential in it, so reading it grants nothing, and it cannot be forged
 * without the server secret. It is bound to the user id specifically so a marker
 * earned by one administrator is inert in another's session.
 *
 * HttpOnly, so no script can read or mint it; `sameSite: "strict"` because
 * unlike the login session there is no cross-site navigation that needs to
 * carry it, and strict is the stronger choice wherever it is affordable.
 *
 * ── The secret ────────────────────────────────────────────────────────────
 *
 * `ADMIN_REAUTH_SECRET`, falling back to `SUPABASE_SERVICE_ROLE_KEY` — both are
 * server-only env vars that already exist in this deployment. 🔴 The fallback is
 * only used as HMAC key material and is never transmitted, logged, or exposed;
 * if neither is present the module FAILS CLOSED (`verify` returns false), so a
 * misconfigured environment refuses sensitive actions rather than waving them
 * through.
 */

const COOKIE = "frenz_admin_reauth";

/** How long a proof stays good. Long enough to complete a task, short enough to matter. */
const TTL_MINUTES = 10;

function secret(): string | null {
  const s =
    process.env.ADMIN_REAUTH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return s ? s : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Called after a successful password re-entry. */
export async function markReauthenticated(userId: string): Promise<void> {
  const key = secret();
  if (!key) return;

  const expiry = Date.now() + TTL_MINUTES * 60_000;
  const payload = `${userId}.${expiry}`;
  const value = `${payload}.${sign(payload, key)}`;

  const jar = await cookies();
  jar.set(COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MINUTES * 60,
  });
}

/**
 * Has this administrator re-authenticated recently?
 *
 * 🔴 Fails closed on every abnormal path: no secret, no cookie, malformed
 * cookie, bad signature, expired, or a different user id.
 */
export async function hasRecentReauth(userId: string): Promise<boolean> {
  const key = secret();
  if (!key) return false;

  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;

  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [id, expiryRaw, mac] = parts as [string, string, string];

  const expected = sign(`${id}.${expiryRaw}`, key);

  /*
    Constant-time compare. A `===` on an HMAC leaks, through timing, how many
    leading bytes matched — which is enough to forge one byte at a time given
    enough attempts. `timingSafeEqual` throws on a length mismatch, so the
    lengths are checked first.
  */
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  if (id !== userId) return false;

  const expiry = Number(expiryRaw);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Drop the marker — on logout, and after a sensitive action completes. */
export async function clearReauth(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Guard for a sensitive server action or route.
 *
 * Composes with `requireAdminApi()` rather than replacing it: being an
 * administrator and having proved it recently are two separate conditions, and
 * a caller must satisfy both.
 */
export async function requireRecentReauth(userId: string): Promise<void> {
  if (!(await hasRecentReauth(userId))) {
    throw new Error("REAUTH_REQUIRED");
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GATE FOR DANGEROUS OPERATIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both conditions in one call: a verified administrator AND a recent password
 * re-entry. Used by the routes that move money, change payment settings, or
 * alter other people's data.
 *
 * ── 🔴 THIS ONE ANSWERS 403, NOT 404 ──────────────────────────────────────
 *
 * Everywhere else an unauthorized admin API answers 404, to avoid confirming
 * the endpoint exists. Here the caller has ALREADY proved they are an
 * administrator — they are simply stale — so there is nothing left to conceal
 * and a 404 would be actively unhelpful: the dashboard could not tell "you may
 * not do this" apart from "this endpoint moved", and the operator would see a
 * broken button instead of a password prompt.
 *
 * The `code` is what the client keys on. A string rather than the status alone,
 * because 403 is also what an ordinary authorization failure looks like and the
 * two need different UI.
 */
export async function requireSensitiveAdmin(): Promise<
  { ok: true; user: import("@supabase/supabase-js").User } | { ok: false; response: Response }
> {
  const { requireAdminApi } = await import("./require-admin");

  const gate = await requireAdminApi();
  if (!gate.ok) return { ok: false, response: gate.response };

  if (!(await hasRecentReauth(gate.user.id))) {
    return {
      ok: false,
      response: Response.json(
        {
          error: "Confirm your password to continue.",
          code: "REAUTH_REQUIRED",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user: gate.user };
}
