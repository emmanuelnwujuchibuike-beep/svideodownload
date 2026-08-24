import { randomUUID } from "node:crypto";

/**
 * Who a streak belongs to.
 *
 * ── 🔴 THE ANONYMOUS IDENTITY IS AN httpOnly COOKIE, NOT localStorage ─────
 * The brief is explicit that ordinary localStorage must not be the
 * authoritative anonymous identity (§4), and it is right: it is per-origin
 * per-storage-area, readable and writable by any script on the page, wiped by
 * "clear site data", and invisible to the server — which means the SERVER could
 * never be authoritative, and §18 requires that it is.
 *
 * A server-minted httpOnly cookie fixes all four. It is created by the server,
 * unreadable and unwritable from JavaScript, sent automatically on every
 * request (so five tabs and a PWA relaunch are the same identity), and survives
 * a browser restart. The client still keeps a copy of the streak NUMBER in
 * localStorage, but purely to paint the hero chip without a round trip — that
 * value is display cache and is never read back as truth.
 *
 * What this deliberately does NOT try to do is make the identity
 * unfalsifiable. Someone who clears cookies gets a new identity and a fresh
 * streak; that costs them their progress rather than gaining them anything,
 * which is the right side of the trade. What it does prevent is the cheap win —
 * editing a stored number to claim a 400-day streak.
 */

/** 400 days: the longest a browser will honour, and longer than any streak gap. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const STREAK_COOKIE = "frenz_sid";

export type StreakIdentity =
  | { kind: "user"; userId: string; anonId: string | null }
  | { kind: "anon"; anonId: string };

/** A new opaque anonymous id. Server-minted so the client never chooses it. */
export function mintAnonId(): string {
  return randomUUID();
}

/**
 * Read the anon id a request carries, if any.
 *
 * Validated as a UUID rather than trusted as-is: the cookie is httpOnly but a
 * request is still just bytes, and this value goes into a database filter.
 */
export function readAnonId(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== STREAK_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? value
      : null;
  }
  return null;
}

/** The `Set-Cookie` value that plants an anonymous identity. */
export function anonCookie(anonId: string, secure: boolean): string {
  const parts = [
    `${STREAK_COOKIE}=${anonId}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    // Lax, not Strict: the PWA and ordinary top-level navigations must carry it,
    // and it authorises nothing, so there is no CSRF surface to tighten against.
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** True for a real deployment; false on plain-HTTP localhost, where `Secure` would drop the cookie. */
export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}

/**
 * Resolve the identity for a request.
 *
 * A signed-in visitor keeps their anon id in hand so the caller can merge it
 * (§5) — sign-in is the one moment both identities are visible at once.
 */
export function resolveIdentity(request: Request, userId: string | null): StreakIdentity {
  const anonId = readAnonId(request);
  if (userId) return { kind: "user", userId, anonId };
  return { kind: "anon", anonId: anonId ?? mintAnonId() };
}
