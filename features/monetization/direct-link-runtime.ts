import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { foreignOpenCount, installOpenObserver, openOwnWindow, setThirdPartyOpenGate, suppressForeignOpens } from "@/lib/monetization/open-observer";
import { directLinkRollWins, isValidDirectLinkUrl, type DirectLinkSpot } from "@/lib/monetization/direct-link";
import { spotOutcome, type PublicSpotPopunder, type SpotOutcome } from "@/lib/monetization/spot-popunder";

/**
 * The tap logic for one ad spot, in its own chunk (useDirectLink imports it after mount) so the
 * routes that carry the hook pay a few bytes, not the policy.
 *
 * Two formats at the same spot (owner, 2026-10-23): the Monetag POP-UNDER is the main one, the
 * direct link the backup — "only when there's no pop under or if the browser blocked it. Both
 * shouldn't show." (lib/monetization/spot-popunder.ts). Part 2.1 safety rules:
 *   · nothing global is blocked: other scripts' windows are only COUNTED (lib/monetization/open-observer.ts);
 *   · the pop-under tag PRELOADS shortly after an enabled spot is shown to a member who sees ads (owner,
 *     2026-10-23: "the pop under is not working"): loaded on the first press, it arrived after that press, and a
 *     pop-under can only open INSIDE a tap — so the first tap at a spot could never show it. Only a page that
 *     carries an ENABLED spot loads it, after first paint (the cold-entry budget); a press still loads it if the
 *     preload has not run yet;
 *   · the decision is made INSIDE the tap (a listener at the end of the same click), so the direct link
 *     opens under the tap's own user activation; a timer is only the fallback when the click never reaches
 *     that listener, and never counts as proof that anything opened;
 *   · proof of a pop-under is a window the browser really returned (a blocked one returns null → the
 *     direct link is tried) or the page losing focus to it;
 *   · after the direct link opens, a pop-under arriving late on that tap is refused for 1.5 s;
 *   · one decision per tap, however many handlers call the opener.
 */
export type SpotOpener = (onOutcome?: (o: SpotOutcome) => void) => boolean;

/** Each element that carries a spot names it, so a press there loads/arms the pop-under. */
export const AD_SPOT_ATTRIBUTE = "data-ad-spot";

const LATE_POPUNDER_MS = 1500;
/** How long after an enabled spot appears the tag preloads — after first paint, before a member's first tap. */
export const POPUNDER_PRELOAD_MS = 1200;
type TagState = "idle" | "loading" | "ready" | "failed";
let tagState: TagState = "idle";
let popunder: PublicSpotPopunder | null = null;
let pressListening = false;
/** this tap: when it was armed, the foreign-open count then, and whether the page lost focus since */
let armed: { at: number; opened: number; lostFocus: boolean } | null = null;
let deciding = false;

/**
 * Less aggressive (owner, 2026-10-23): when the last pop-under showed, per visitor (best-effort storage: a private
 * window or blocked storage simply falls back to Monetag's own cap). A pop-under is a normal Monetag impression either way.
 */
const LAST_POPUNDER_KEY = "frenz_spot_popunder_last";
function lastPopunderAt(): number {
  try {
    return Number(window.localStorage?.getItem(LAST_POPUNDER_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function notePopunder(): void {
  try {
    window.localStorage?.setItem(LAST_POPUNDER_KEY, String(Date.now()));
  } catch {
    /* storage blocked: Monetag's own cap still applies */
  }
}
/** Still inside the admin's cooldown since the last pop-under? */
function coolingDown(p: PublicSpotPopunder, now = Date.now()): boolean {
  const mins = Number(p.cooldownMinutes) || 0;
  return mins > 0 && now - lastPopunderAt() < mins * 60_000;
}
/** A tap at an enabled spot is in progress (pressed within the last moment). */
function spotTapNow(now = Date.now()): boolean {
  return !!armed && now - armed.at <= LATE_POPUNDER_MS;
}

function arm(): void {
  const now = Date.now();
  if (!armed || now - armed.at > LATE_POPUNDER_MS) armed = { at: now, opened: foreignOpenCount(), lostFocus: false };
  // pages with the Hilltop guard refuse unannounced windows: the pop-under may open during THIS tap
  allowWindowOpen();
}

function loadTag(p: PublicSpotPopunder): void {
  if (tagState !== "idle") return;
  tagState = "loading";
  installOpenObserver();
  // a third-party window (Monetag's pop-under) only at a spot tap when "spots only" is on, and never inside the cooldown
  setThirdPartyOpenGate({ allow: () => (!p.spotsOnly || spotTapNow()) && !coolingDown(p), onOpened: notePopunder });
  window.addEventListener("blur", () => {
    if (armed) armed.lostFocus = true;
  });
  const el = document.createElement("script");
  el.async = true;
  el.src = p.src;
  if (p.zone) el.dataset.zone = p.zone;
  if (p.cfAsync) el.setAttribute("data-cfasync", "false");
  el.setAttribute("data-monetag", "spot_popunder");
  el.onload = () => {
    tagState = "ready";
  };
  el.onerror = () => {
    // blocked (an ad blocker) or unreachable: the direct link carries every tap from here
    tagState = "failed";
  };
  document.head.appendChild(el);
}

/** A press on an enabled spot: the first one loads the tag; each one arms the pop-under for its tap. */
function onPress(e: PointerEvent): void {
  if (!popunder) return;
  const target = e.target as Element | null;
  let spot = target?.closest?.(`[${AD_SPOT_ATTRIBUTE}]`)?.getAttribute(AD_SPOT_ATTRIBUTE) ?? null;
  if (!spot) {
    // a spot that lets taps through (the wallpaper's caption area is pointer-events-none) is matched by position
    for (const el of document.querySelectorAll(`[${AD_SPOT_ATTRIBUTE}]`)) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        spot = el.getAttribute(AD_SPOT_ATTRIBUTE);
        break;
      }
    }
  }
  if (!spot || !popunder.spots.includes(spot as DirectLinkSpot)) return;
  loadTag(popunder);
  if (tagState === "ready") arm();
}

export async function loadDirectLinkOpener(spot: DirectLinkSpot): Promise<SpotOpener | null> {
  const d = (await loadAdsConfig()) as Record<string, unknown> | null;
  const c = d?.monetagDirectLink as { url: string; spots: string[]; chancePercent: number } | null | undefined;
  const direct = c && c.spots?.includes(spot) && isValidDirectLinkUrl(c.url) ? c : null;
  const pu = d?.monetagSpotPopunder as PublicSpotPopunder | null | undefined;
  const spotPopunder = pu && Array.isArray(pu.spots) && pu.spots.includes(spot) && typeof pu.src === "string" && /^https:\/\//.test(pu.src) ? pu : null;
  if (!direct && !spotPopunder) return null;
  if (spotPopunder) {
    popunder = spotPopunder;
    if (!pressListening) {
      pressListening = true;
      window.addEventListener("pointerdown", onPress, true);
    }
    // ready BEFORE the first tap (a tag loaded by the tap itself arrives too late to open on it)
    window.setTimeout(() => loadTag(spotPopunder), POPUNDER_PRELOAD_MS);
  }

  /** The backup: rolls the admin's chance, then opens in a new tab; a late pop-under is refused for a moment. */
  const openDirect = (): boolean => {
    if (!direct || !directLinkRollWins(direct.chancePercent, Math.random())) return false;
    openOwnWindow(direct.url);
    suppressForeignOpens(LATE_POPUNDER_MS);
    return true;
  };

  return (onOutcome) => {
    if (!spotPopunder || tagState !== "ready") {
      // no pop-under here yet (not set up, the first press is loading it, or it was blocked): the direct link, in the tap
      const opened = openDirect();
      onOutcome?.(spotOutcome({ popunderOpened: false, directOpened: opened }));
      return !!direct;
    }
    if (coolingDown(spotPopunder)) {
      // a pop-under showed a short while ago: this tap opens nothing at all (the direct link included) — less aggressive
      onOutcome?.("none");
      return true;
    }
    if (deciding) return true;
    deciding = true;
    arm();
    const mark = armed!;
    let done = false;
    const decide = () => {
      if (done) return;
      done = true;
      window.removeEventListener("click", decide);
      deciding = false;
      armed = null;
      const popunderOpened = foreignOpenCount() > mark.opened || mark.lostFocus;
      const directOpened = popunderOpened ? false : openDirect();
      onOutcome?.(spotOutcome({ popunderOpened, directOpened }));
    };
    // the end of THIS click's path (after the pop-under's own document listener) — still inside the tap
    window.addEventListener("click", decide);
    // the click never reached the window (a handler stopped it, or this wasn't a click): decide right after
    window.setTimeout(decide, 0);
    return true;
  };
}
