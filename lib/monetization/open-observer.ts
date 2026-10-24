import { allowWindowOpen } from "./popunder-guard";

/**
 * Watches `window.open` for the spot pop-under (Part 2.1) — WITHOUT blocking other scripts.
 *
 * The earlier version installed the pop-under GUARD (popunder-guard.ts) on every page that carried
 * a spot, which refused every unannounced window there — other ad networks' included. This one only
 * counts: a window opened by a script that is not ours (the Monetag pop-under) is recorded, so the
 * direct link knows the pop-under showed and stays shut.
 *
 * It refuses exactly one thing: for a moment right after OUR direct link opened (`suppressForeignOpens`),
 * a foreign window — a pop-under arriving late on that same tap — so the two never both show. That is
 * the whole interception: ~1.5 s, only after a tap at a configured spot opened the direct link.
 *
 * Composes with the guard where it is installed (Hilltop pages): our own opens are announced to it.
 */

const state = { installed: false, foreignOpened: 0, suppressUntil: 0, suppressed: 0, own: false, gated: 0 };

/**
 * The spot pop-under's "less aggressive" rule (owner, 2026-10-23), set by the runtime: may a THIRD-PARTY script open
 * a window right now? Asked only for a call whose stack names a script from another origin (an ad tag) — the app's
 * own windows (downloads, viewers, notifications, VAST click-through) never reach it. `onOpened` hears each one let through.
 */
let thirdPartyGate: { allow: () => boolean; onOpened: () => void } | null = null;

export function setThirdPartyOpenGate(gate: { allow: () => boolean; onOpened: () => void } | null): void {
  thirdPartyGate = gate;
  if (gate) installLinkGate();
}

/**
 * Is this call PROVABLY ours? Owner, 2026-10-23: "still aggressive and opens everywhere even in history". The first
 * version only stopped callers it could NAME as another origin — but an ad tag that runs its code from eval, a blob or an
 * inline script leaves no foreign URL in the stack, and slipped through. Now it is the other way round: a call is ours
 * only when its stack names script files and EVERY one is from this origin (our bundles always are: /_next/…).
 * Anything else — another origin, no file at all, no stack — is treated as an ad's and held to the spot taps.
 */
export function calledByThirdParty(stack: string | undefined, origin: string): boolean {
  if (!stack) return true;
  let ours = 0;
  for (const m of stack.matchAll(/blob:[^\s)'"]+|https?:\/\/[^\s)'"]+/g)) {
    if (m[0].startsWith("blob:")) return true;
    try {
      if (new URL(m[0]).origin !== origin) return true;
      ours += 1;
    } catch {
      return true;
    }
  }
  return ours === 0;
}

/**
 * A link an ad script opens by CLICKING it from code (a synthetic click on an <a target=_blank>) instead of window.open —
 * the other way pop-unders open tabs. Only a synthetic click, a new-tab target, an http(s) page on another origin and no
 * download: a member's own tap (a trusted click) and our download links are never touched.
 */
function adLikeLinkClick(a: HTMLAnchorElement, trusted: boolean): boolean {
  if (trusted || a.hasAttribute("download") || (a.target || "").toLowerCase() !== "_blank") return false;
  try {
    const u = new URL(a.href, window.location.href);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** The gate's verdict for a window or a link click right now; counts what it refused. */
function refusedByGate(stack: string | undefined): boolean {
  if (state.own || !thirdPartyGate) return false;
  if (!calledByThirdParty(stack, window.location?.origin ?? "")) return false;
  if (thirdPartyGate.allow()) return false;
  state.gated += 1;
  return true;
}

let linkGateInstalled = false;
function installLinkGate(): void {
  if (linkGateInstalled || typeof HTMLAnchorElement === "undefined") return;
  linkGateInstalled = true;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function gatedClick(this: HTMLAnchorElement) {
    if (adLikeLinkClick(this, false)) {
      const stack = new Error().stack;
      if (refusedByGate(stack)) return;
      if (!state.own && thirdPartyGate && calledByThirdParty(stack, window.location?.origin ?? "")) thirdPartyGate.onOpened();
    }
    return click.call(this);
  };
  // a synthetic click DISPATCHED on a link in the page: first in line (capture on window), cancelled when refused
  window.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (a && adLikeLinkClick(a, e.isTrusted) && refusedByGate(new Error().stack)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

export function installOpenObserver(): void {
  if (typeof window === "undefined" || state.installed) return;
  state.installed = true;
  const prev = window.open.bind(window);
  window.open = function observedOpen(url?: string | URL, target?: string, features?: string): Window | null {
    if (!state.own && Date.now() < state.suppressUntil) {
      state.suppressed += 1;
      return null;
    }
    const stack = new Error().stack;
    const thirdParty = !state.own && !!thirdPartyGate && calledByThirdParty(stack, window.location?.origin ?? "");
    if (thirdParty && refusedByGate(stack)) return null;
    const w = prev(url as string, target as string, features as string);
    // a browser's own popup blocker returns null: that is NOT a pop-under that showed
    if (w && !state.own) state.foreignOpened += 1;
    if (w && thirdParty) thirdPartyGate?.onOpened();
    return w;
  } as typeof window.open;
}

/** Windows other scripts really opened (non-null), since the page loaded. */
export function foreignOpenCount(): number {
  return state.foreignOpened;
}

/** Open OUR link in a new tab (announced to the guard where it is installed). */
export function openOwnWindow(url: string): void {
  state.own = true;
  try {
    allowWindowOpen();
    /*
      2026-10-24 (owner: Adsterra Smartlink stats): "noopener" only — NOT "noreferrer". With noreferrer the ad network got
      no referring site at all, so the visit could not be attributed to frenzsave.com (Domain stats) and reads as
      direct / unknown-source traffic, which networks value lower. The site's Referrer-Policy
      (strict-origin-when-cross-origin, next.config.ts) still sends only the ORIGIN — never a path or query — and
      noopener still keeps the ad page from reaching back into ours.
    */
    window.open(url, "_blank", "noopener");
  } finally {
    state.own = false;
  }
}

/** After our direct link opened: refuse foreign windows for `ms` (a late pop-under on the same tap). */
export function suppressForeignOpens(ms: number): void {
  state.suppressUntil = Date.now() + ms;
}

export function openObserverStats(): { installed: boolean; foreignOpened: number; suppressed: number; gated: number } {
  return { installed: state.installed, foreignOpened: state.foreignOpened, suppressed: state.suppressed, gated: state.gated };
}
