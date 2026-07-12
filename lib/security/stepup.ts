import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * A narrow, short-lived signed cookie proving "this already-identified user
 * also proved biometric passkey possession recently, for THIS purpose" —
 * deliberately NOT an identity or session token. Every route/page gating on
 * this already requires a valid Supabase session (getSessionUser) as a
 * prerequisite; this answers a strictly narrower question layered on top.
 *
 * Uses next/headers `cookies()` for both read and write — callable from
 * Route Handlers AND Server Components alike (Server Components need this
 * too, for the PIN-lock SSR gate — see app/(app)/messages/page.tsx), so no
 * `Request` object is needed at all.
 */
const COOKIE_NAME = "frenz_stepup";
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function sign(payload: string): string {
  const secret = process.env.STEPUP_SIGNING_SECRET;
  if (!secret) throw new Error("STEPUP_SIGNING_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function issueStepUp(userId: string, purpose: string, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${purpose}.${exp}`;
  const store = await cookies();
  store.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

function verifyRaw(raw: string | undefined, userId: string, purpose: string): boolean {
  try {
    if (!raw) return false;
    const parts = raw.split(".");
    if (parts.length !== 4) return false;
    const [uid, p, expStr, sig] = parts as [string, string, string, string];
    const expected = sign(`${uid}.${p}.${expStr}`);
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;
    if (uid !== userId || p !== purpose) return false;
    return Date.now() < Number(expStr);
  } catch {
    return false;
  }
}

/** Whether the caller already cleared a step-up (passkey OR PIN, depending on `purpose`) for this exact (userId, purpose) within its TTL. */
export async function hasValidStepUp(userId: string, purpose: string): Promise<boolean> {
  const store = await cookies();
  return verifyRaw(store.get(COOKIE_NAME)?.value, userId, purpose);
}
