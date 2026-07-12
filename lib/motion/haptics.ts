/**
 * Frenz Motion — the app's single haptic vocabulary. Every `navigator.vibrate`
 * call site used to pick its own magic number (6, 8, 10, 12, 18, 35 all showed
 * up independently across a dozen files, each meaning roughly the same thing);
 * this collects them into 4 named intents so a light tap, a selection, and a
 * celebratory moment feel deliberately different but consistent everywhere,
 * the same way `lib/motion/springs.ts` did for spring physics. Near-identical
 * values (6 vs 8, 10 vs 12) are intentionally merged into one shared tier —
 * a handful of distinguishable, reusable intents beats a dozen arbitrary
 * near-duplicate numbers no one could tell apart anyway.
 *
 * iOS (2026-07-12): Safari/WKWebView has NEVER supported the Vibration API —
 * `navigator.vibrate` is simply undefined there, so every haptic silently
 * no-op'd on exactly the devices the owner tests on ("the haptic doesn't even
 * work"). The only web-exposed haptic on iOS is the system tick fired when a
 * native `<input type="checkbox" switch>` control toggles (Safari 17.4+'s
 * switch control; the haptic ships with iOS 18) — clicking a visually-hidden
 * switch from inside a user-gesture call stack reproduces the standard iOS
 * selection tick. That's the fallback here. Two honest limits, both platform
 * facts not bugs: (1) it only fires inside a genuine user gesture, so
 * gesture-less triggers (an incoming message while you're just reading) stay
 * silent on iOS — nothing on the web platform can do that today; (2) it's one
 * fixed system tick, so intent tiers all feel the same on iOS.
 */

const PATTERNS = {
  /** A light acknowledgement — double-tap-to-Wow, pull-to-refresh trigger,
   *  a seek/step gesture. The most common, lowest-weight buzz. */
  light: 8,
  /** A deliberate action landed — sending a repost/share, a long-press
   *  selection registering. */
  selection: 12,
  /** Something worth celebrating slightly more — a repost/share confirmed,
   *  a milestone-flavored moment. */
  medium: 18,
  /** A rare, maximal moment (e.g. an Easter egg unlock). Used sparingly. */
  strong: 35,
} as const;

export type HapticIntent = keyof typeof PATTERNS;

let iosSwitch: HTMLInputElement | null = null;
function iosHapticTick(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (!iosSwitch || !iosSwitch.isConnected) {
    const label = document.createElement("label");
    // Hidden but NOT display:none (a display:none control never toggles) and
    // inert to the page: zero size, no pointer events, out of the a11y tree.
    label.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1";
    label.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    input.type = "checkbox";
    // Non-standard attribute — Safari's native switch control. Other browsers
    // just see a hidden checkbox that toggles to no effect.
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = input;
  }
  iosSwitch.click();
}

/** Fire a named haptic. Uses the Vibration API where it exists (Android,
 *  desktop no-ops harmlessly) and the iOS switch-control system tick where it
 *  doesn't — never throws, never needs its own try/catch at the call site. */
export function haptic(intent: HapticIntent): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[intent]);
      return;
    }
    iosHapticTick();
  } catch {
    /* unsupported */
  }
}

/** A custom vibration pattern for the rare case a named intent isn't a fit
 *  (e.g. share-sheet's multi-pulse copy-link confirmation). */
export function hapticPattern(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
      return;
    }
    iosHapticTick();
  } catch {
    /* unsupported */
  }
}
