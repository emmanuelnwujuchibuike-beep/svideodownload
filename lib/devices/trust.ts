/**
 * Device Trust Engine™ — Feature 18 · Part 23.
 *
 * ── What already existed, and what this adds ─────────────────────────────────
 * The plumbing was here before this file: migration 0054 gives every browser a
 * long-lived `device_key` and a `trusted_devices` row (label, `is_trusted`,
 * first/last seen, last user agent), `mergeSessionsWithDevices` left-joins that
 * onto Supabase's real session list, and `/account/security` already lists
 * sessions with sign-out, rename and a trust toggle.
 *
 * What did NOT exist is any notion of what trust MEANS. `is_trusted` was a
 * boolean an owner could flip, and nothing anywhere read it to decide anything.
 * A trust flag that changes no behaviour is decoration.
 *
 * So this file is the missing half: a small set of levels, a pure function that
 * derives one from evidence, and — the part that makes it real — a capability
 * map, so a level is a statement about what a device may DO rather than a badge.
 *
 * ── Derived, never stored ────────────────────────────────────────────────────
 * The level is computed from the row on every read. Storing it would create a
 * second source of truth that goes stale the moment a device is used again, and
 * this project has already been bitten by exactly that shape of bug in the
 * analytics stack. `is_trusted` remains the one persisted fact, because it is
 * the one thing only a person can decide.
 *
 * ── The signals are the ones we ACTUALLY have ────────────────────────────────
 * The brief asks for impossible-travel detection, rooted/jailbroken detection,
 * battery level and network type. Deliberately absent, with reasons, because
 * inventing a security signal is worse than not having one — it produces a
 * confident verdict with nothing behind it:
 *
 *   • Impossible travel needs a per-session IP and a geolocation lookup.
 *     `trusted_devices` stores no IP and there is no geo provider wired in.
 *   • Root/jailbreak detection is not observable from a web page at all. Any
 *     browser-side "check" is trivially spoofed and would be theatre.
 *   • `navigator.getBattery()` has been removed from Firefox and Safari, and
 *     the Network Information API is Chromium-only. Both are reported for the
 *     CURRENT device only, where the browser answers, and shown nowhere else.
 *
 * Everything below is derived from data the row genuinely holds.
 */

export type TrustLevel = "current" | "trusted" | "recognised" | "new" | "dormant" | "restricted";

export interface TrustLevelSpec {
  id: TrustLevel;
  label: string;
  /** One line a person reads on the device card. */
  blurb: string;
  /** Ordering for the list — lower sorts first. */
  rank: number;
  /** Visual weight; the UI maps these to tokens rather than inventing colours. */
  tone: "positive" | "neutral" | "caution";
}

export const TRUST_LEVELS: TrustLevelSpec[] = [
  { id: "current", label: "This device", blurb: "The device you are using right now.", rank: 0, tone: "positive" },
  { id: "trusted", label: "Trusted", blurb: "You marked this device as yours. It skips extra checks.", rank: 1, tone: "positive" },
  { id: "recognised", label: "Recognised", blurb: "Signed in before and used recently.", rank: 2, tone: "neutral" },
  { id: "new", label: "New", blurb: "First seen in the last day. Check it was you.", rank: 3, tone: "caution" },
  { id: "dormant", label: "Dormant", blurb: "Signed in, but not used for a long time.", rank: 4, tone: "caution" },
  { id: "restricted", label: "Restricted", blurb: "Trust was removed. Sensitive actions ask again.", rank: 5, tone: "caution" },
];

const BY_ID = new Map(TRUST_LEVELS.map((l) => [l.id, l]));

export function trustLevel(id: TrustLevel): TrustLevelSpec {
  return BY_ID.get(id) ?? BY_ID.get("recognised")!;
}

/**
 * What a device at a given level may do without asking again.
 *
 * This is the whole point of the engine. Each capability names a real decision
 * some surface makes, so a level is enforceable rather than cosmetic — and a
 * capability that nothing consults would be the same decoration this file
 * exists to replace, which is why the list is short and every entry is real.
 */
export interface TrustCapabilities {
  /** Skip the "new device" security email/notification on sign-in. */
  skipNewDeviceAlert: boolean;
  /** Allow a step-up-free change to security settings from this device. */
  changeSecuritySettings: boolean;
  /** Keep the session alive across restarts rather than expiring it sooner. */
  longLivedSession: boolean;
  /** Offer to remember this device for future sign-ins. */
  offerRemember: boolean;
}

export function capabilitiesFor(level: TrustLevel): TrustCapabilities {
  switch (level) {
    case "current":
    case "trusted":
      return { skipNewDeviceAlert: true, changeSecuritySettings: true, longLivedSession: true, offerRemember: false };
    case "recognised":
      return { skipNewDeviceAlert: true, changeSecuritySettings: false, longLivedSession: true, offerRemember: true };
    case "new":
      return { skipNewDeviceAlert: false, changeSecuritySettings: false, longLivedSession: false, offerRemember: true };
    case "dormant":
      // Not suspicious, just cold. It has to prove itself again before it can
      // change the things an attacker with a stale session would want to change.
      return { skipNewDeviceAlert: false, changeSecuritySettings: false, longLivedSession: false, offerRemember: true };
    case "restricted":
      return { skipNewDeviceAlert: false, changeSecuritySettings: false, longLivedSession: false, offerRemember: false };
  }
}

/** Evidence the engine is allowed to reason from — all of it really stored. */
export interface TrustSignals {
  isCurrent: boolean;
  /** The persisted flag a person set themselves. */
  isTrusted: boolean;
  /** True once the person has explicitly REMOVED trust, as opposed to never granting it. */
  trustRevoked?: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** The user agent recorded when the row was created, and the one seen now. */
  originalUserAgent?: string | null;
  currentUserAgent?: string | null;
}

/** A device seen for the first time within this window is still "new". */
export const NEW_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** No activity for this long and a device is dormant rather than recognised. */
export const DORMANT_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function parsed(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * The level for one device.
 *
 * Order matters and is the whole design:
 *
 *   1. The device in your hand is never anything else. Showing "new" or
 *      "dormant" against the screen someone is looking at is the fastest way to
 *      make a security screen untrustworthy.
 *   2. An explicit revocation outranks everything derivable. A person who took
 *      trust away has made a decision, and a device must not quietly climb back
 *      to "recognised" by being used.
 *   3. Explicit trust outranks the time-based signals for the same reason in
 *      the other direction.
 *   4. Only then do age and recency decide.
 *
 * An UNPARSEABLE or missing timestamp resolves to "recognised", not to "new".
 * Missing data is not evidence of anything, and the alternative would flag every
 * device that predates the column as suspicious.
 */
export function evaluateTrust(signals: TrustSignals, now = Date.now()): TrustLevel {
  if (signals.isCurrent) return "current";
  if (signals.trustRevoked) return "restricted";
  if (signals.isTrusted) return "trusted";

  const first = parsed(signals.firstSeenAt);
  const last = parsed(signals.lastSeenAt);

  if (first !== null && now - first < NEW_DEVICE_WINDOW_MS) return "new";
  if (last !== null && now - last > DORMANT_AFTER_MS) return "dormant";
  return "recognised";
}

/* ─────────────────────────────── observations ───────────────────────────── */

export type ObservationId = "new-device" | "dormant" | "agent-changed" | "trust-removed";

export interface Observation {
  id: ObservationId;
  /** Stated as what we SAW, never as a verdict about the person. */
  text: string;
  tone: "neutral" | "caution";
}

/**
 * Plain-language notes about a device, from the same evidence.
 *
 * Written as observations rather than accusations — "first seen today" instead
 * of "suspicious device". We cannot tell an attacker from a new laptop, and a
 * security screen that cries wolf teaches people to dismiss it, which is the
 * one outcome worse than saying nothing.
 *
 * `agent-changed` is the closest thing to a real anomaly signal available here:
 * the same long-lived `device_key` cookie now arriving with a materially
 * different user agent. It is reported, not acted on, because a browser upgrade
 * produces it too.
 */
export function observationsFor(signals: TrustSignals, now = Date.now()): Observation[] {
  const out: Observation[] = [];
  const level = evaluateTrust(signals, now);

  if (level === "new") out.push({ id: "new-device", text: "First seen in the last 24 hours.", tone: "caution" });
  if (level === "dormant") out.push({ id: "dormant", text: "No activity for over a month.", tone: "caution" });
  if (level === "restricted") out.push({ id: "trust-removed", text: "You removed trust from this device.", tone: "caution" });

  const before = signals.originalUserAgent?.trim();
  const after = signals.currentUserAgent?.trim();
  if (before && after && before !== after) {
    out.push({
      id: "agent-changed",
      text: "The browser or system on this device has changed since it was first seen.",
      tone: "neutral",
    });
  }
  return out;
}

/** Sort devices the way a person scans them: theirs first, then by concern. */
export function compareByTrust(a: TrustLevel, b: TrustLevel): number {
  return trustLevel(a).rank - trustLevel(b).rank;
}
