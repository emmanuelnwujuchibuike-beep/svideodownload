/**
 * Security Score (Feature 18 · Part 19).
 *
 * ── Why a score at all, and what makes this one honest ────────────────────
 * Every input already existed — MFA factors (0057), passkeys (0058), a PIN
 * (0056), recovery codes (0057), trusted devices (0054), email confirmation.
 * Nothing added them up, so a member had six screens and no answer to the one
 * question they actually have: "am I safe?"
 *
 * Two rules keep a score like this from becoming theatre:
 *
 *  1. It only counts things that CHANGE AN ATTACKER'S JOB. Recovery codes and
 *     a PIN are worth real points because they defeat specific attacks. There
 *     are no points for "completed your profile" or "read the security tips" —
 *     padding a security score with engagement metrics teaches people that a
 *     high number is easy, which is the opposite of what it is for.
 *  2. It never says "excellent" while a critical gap is open. A member with no
 *     second factor cannot reach the top band however many passkeys they have,
 *     because the weakest link is what an attacker uses. `band` is therefore
 *     capped by the gaps, not derived from the total alone.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 * No "risk level" inferred from behaviour, no anomaly guessing. Telling
 * someone they are "at risk" from a heuristic — a new country, an odd hour —
 * is how a travelling member gets frightened by their own holiday. Real
 * signals (a new device, a failed step-up) are already recorded in
 * `security_audit_log` and shown as facts on the activity list.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface SecurityInputs {
  /** A TOTP factor is enrolled and verified. */
  mfaEnabled: boolean;
  /** Registered WebAuthn credentials (passkeys / hardware keys). */
  passkeyCount: number;
  /** Unused recovery codes remaining. */
  recoveryCodesRemaining: number;
  /** A security PIN is set. */
  pinSet: boolean;
  /** Devices the member has explicitly marked trusted. */
  trustedDeviceCount: number;
  /** The account's email address is confirmed. */
  emailConfirmed: boolean;
  /** Step-up is required when signing in on an unrecognised device. */
  stepUpOnNewDevice: boolean;
}

export type SecurityBand = "at-risk" | "basic" | "good" | "strong";

export interface SecurityGap {
  key: string;
  title: string;
  /** What this actually prevents — never a generic "improve your security". */
  why: string;
  /** Where to fix it. */
  href: string;
  /**
   * `critical` gaps cap the band no matter the score. They are the ones where
   * a stolen password alone is enough to take the account.
   */
  severity: "critical" | "recommended";
  points: number;
}

export interface SecurityScore {
  score: number;
  band: SecurityBand;
  gaps: SecurityGap[];
  /** Things already in place, so the screen credits work already done. */
  strengths: string[];
}

export const BAND_LABEL: Record<SecurityBand, string> = {
  "at-risk": "Needs attention",
  basic: "Basic",
  good: "Good",
  strong: "Strong",
};

/** Weights sum to 100. Second factors dominate because they defeat the common attack. */
const POINTS = {
  mfa: 30,
  passkey: 25,
  recoveryCodes: 15,
  emailConfirmed: 10,
  pin: 10,
  stepUp: 5,
  trustedDevices: 5,
} as const;

export function securityScore(input: SecurityInputs): SecurityScore {
  const gaps: SecurityGap[] = [];
  const strengths: string[] = [];
  let score = 0;

  const hasSecondFactor = input.mfaEnabled || input.passkeyCount > 0;

  if (input.mfaEnabled) {
    score += POINTS.mfa;
    strengths.push("Two-factor authentication is on");
  } else {
    gaps.push({
      key: "mfa",
      title: "Turn on two-factor authentication",
      why: "Without it, anyone who learns your password is in. With it, they also need your phone.",
      href: "/account/security",
      severity: input.passkeyCount > 0 ? "recommended" : "critical",
      points: POINTS.mfa,
    });
  }

  if (input.passkeyCount > 0) {
    score += POINTS.passkey;
    strengths.push(
      input.passkeyCount === 1 ? "1 passkey registered" : `${input.passkeyCount} passkeys registered`,
    );
  } else {
    gaps.push({
      key: "passkey",
      title: "Add a passkey",
      why: "A passkey cannot be phished — it only works on this site, so a convincing fake login page gets nothing.",
      href: "/account/security",
      severity: input.mfaEnabled ? "recommended" : "critical",
      points: POINTS.passkey,
    });
  }

  if (input.recoveryCodesRemaining > 0) {
    score += POINTS.recoveryCodes;
    strengths.push(`${input.recoveryCodesRemaining} recovery codes left`);
  } else {
    gaps.push({
      key: "recovery",
      title: "Generate recovery codes",
      why: hasSecondFactor
        ? "If you lose your phone, these are the only way back into your own account."
        : "Your way back in if you ever lose access to your sign-in method.",
      href: "/account/security",
      // Critical only once a second factor exists: without codes, losing that
      // factor locks the member out permanently, and being locked out of your
      // own account is a security failure too.
      severity: hasSecondFactor ? "critical" : "recommended",
      points: POINTS.recoveryCodes,
    });
  }

  if (input.emailConfirmed) {
    score += POINTS.emailConfirmed;
    strengths.push("Email confirmed");
  } else {
    gaps.push({
      key: "email",
      title: "Confirm your email address",
      why: "An unconfirmed address cannot receive a security alert or a recovery link.",
      href: "/account",
      severity: "critical",
      points: POINTS.emailConfirmed,
    });
  }

  if (input.pinSet) {
    score += POINTS.pin;
    strengths.push("Security PIN set");
  } else {
    gaps.push({
      key: "pin",
      title: "Set a security PIN",
      why: "Asked for before sensitive changes, so someone using your unlocked phone still cannot alter your account.",
      href: "/account/security",
      severity: "recommended",
      points: POINTS.pin,
    });
  }

  if (input.stepUpOnNewDevice) {
    score += POINTS.stepUp;
    strengths.push("New devices must verify");
  }

  if (input.trustedDeviceCount > 0) {
    score += POINTS.trustedDevices;
  }

  score = Math.max(0, Math.min(100, score));

  return { score, band: bandFor(score, gaps), gaps: sortGaps(gaps), strengths };
}

/**
 * The band is capped by open critical gaps, not read off the score.
 *
 * Someone can accumulate a respectable total from a PIN, a confirmed email and
 * trusted devices while having no second factor at all. Calling that "Strong"
 * would be the score lying about the only thing that matters.
 */
function bandFor(score: number, gaps: readonly SecurityGap[]): SecurityBand {
  const criticals = gaps.filter((g) => g.severity === "critical").length;
  if (criticals >= 2) return "at-risk";
  if (criticals === 1) return score >= 50 ? "basic" : "at-risk";
  if (score >= 85) return "strong";
  if (score >= 60) return "good";
  return "basic";
}

/** Critical first, then by how much each is worth — the useful order to act in. */
function sortGaps(gaps: SecurityGap[]): SecurityGap[] {
  return [...gaps].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.points - a.points;
  });
}

/** The single most valuable next step, or null when there is nothing to fix. */
export function nextSecurityStep(result: SecurityScore): SecurityGap | null {
  return result.gaps[0] ?? null;
}
