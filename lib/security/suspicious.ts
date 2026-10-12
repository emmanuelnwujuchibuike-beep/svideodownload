/**
 * SUSPICIOUS ACTIVITY ENGINE (Feature 20 Part 7) — explainable rules over the member's OWN
 * security log (security_audit_log, 0053). No model: every alert names the rule that fired
 * and the facts behind it, so a member can always see why.
 *
 *   new_country       a sign-in from a country this account has not signed in from in 30 days
 *                     (only once the account has some sign-in history with a known country)
 *   two_countries     sign-ins from two different countries within 6 hours
 *                     (the honest form of "impossible travel": country-level, no IP lookups)
 *   failed_checks     5+ failed security checks (recovery code, passkey step-up) in an hour
 *   pin_lockout       the security PIN locked after repeated wrong entries
 *
 * The country is the edge's own header (Cloudflare / Vercel) — no IP-geolocation service, no
 * raw IP stored (the log keeps only a keyed hash). Pure here; lib/security/suspicious-run.ts
 * reads the log and sends the alert.
 */
export type SuspicionReason = "new_country" | "two_countries" | "failed_checks" | "pin_lockout";

export interface LoginFact {
  country: string | null;
  at: number;
}

export interface Suspicion {
  reason: SuspicionReason;
  title: string;
  body: string;
}

export const NEW_COUNTRY_WINDOW_MS = 30 * 86_400_000;
export const TWO_COUNTRIES_MS = 6 * 3_600_000;
export const FAILED_CHECKS_WINDOW_MS = 3_600_000;
export const FAILED_CHECKS_AT = 5;

/** A country header value we trust: two letters, not Cloudflare's "unknown"/"Tor" markers. */
export function cleanCountry(v: string | null | undefined): string | null {
  const c = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

/** `current` is the sign-in that just happened; `history` the earlier ones, newest first. */
export function assessSignIn(current: LoginFact, history: readonly LoginFact[]): Suspicion | null {
  if (!current.country) return null;
  const recent = history.filter((h) => h.country && current.at - h.at <= TWO_COUNTRIES_MS && current.at >= h.at);
  const other = recent.find((h) => h.country !== current.country);
  if (other) {
    return {
      reason: "two_countries",
      title: "Sign-ins from two countries",
      body: `Your account signed in from ${current.country} and, within 6 hours, from ${other.country}. If one wasn't you, end that session and change your password.`,
    };
  }
  const known = history.filter((h) => h.country && current.at - h.at <= NEW_COUNTRY_WINDOW_MS);
  if (known.length >= 1 && !known.some((h) => h.country === current.country)) {
    return {
      reason: "new_country",
      title: "Sign-in from a new country",
      body: `Your account signed in from ${current.country}, a country it hasn't signed in from in the last 30 days. If this wasn't you, end that session and change your password.`,
    };
  }
  return null;
}

/** Failed security checks in the last hour (timestamps, any order). */
export function assessFailures(failedAt: readonly number[], now: number): Suspicion | null {
  const n = failedAt.filter((t) => now - t <= FAILED_CHECKS_WINDOW_MS).length;
  if (n < FAILED_CHECKS_AT) return null;
  return {
    reason: "failed_checks",
    title: "Repeated failed security checks",
    body: `${n} failed security checks (recovery codes or passkey confirmation) in the last hour. If this wasn't you, change your password and review your devices.`,
  };
}

export const PIN_LOCKOUT: Suspicion = {
  reason: "pin_lockout",
  title: "Security PIN locked",
  body: "Your security PIN was entered wrongly too many times and is locked for now. If this wasn't you, change your password and review your devices.",
};
