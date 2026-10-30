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

/** A third-party window (the pop-under) only at a spot tap when "spots only" is on, and never inside the cooldown. */
function openGateFor(p: PublicSpotPopunder): void {
  setThirdPartyOpenGate({ allow: () => (!p.spotsOnly || spotTapNow()) && !coolingDown(p), onOpened: notePopunder });
}

/**
 * The admin turned the pop-under OFF while its tag is already in this page (owner, 2026-10-29: "I off the main switch
 * but the reward video X button still clicks the smart link"). A loaded script cannot be unloaded, so it is disarmed:
 * no spot arms it any more and every window it tries to open is refused (lib/monetization/open-observer.ts). The member
 * gets no ad and their tap's own action — the download, the close — runs as normal. Turned back on, the gate reopens.
 */
function disarmLoadedPopunder(): void {
  popunder = null;
  armed = null;
  if (tagState !== "idle") setThirdPartyOpenGate({ allow: () => false, onOpened: () => {} });
}

function loadTag(p: PublicSpotPopunder): void {
  if (tagState !== "idle") return;
  tagState = "loading";
  installOpenObserver();
  openGateFor(p);
  window.addEventListener("blur", () => {
    if (armed) armed.lostFocus = true;
  });
  const el = document.createElement("script");
  el.async = true;
  el.src = p.src;
  if (p.zone) el.dataset.zone = p.zone;
  if (p.cfAsync) el.setAttribute("data-cfasync", "false");
  // Monetag or Adsterra (the admin's pick, 2026-10-24): the same tap rules either way — this only labels the tag
  el.setAttribute(p.provider === "adsterra" ? "data-adsterra" : "data-monetag", "spot_popunder");
  el.onload = () => {
    tagState = "ready";
  };
  el.onerror = () => {
    // blocked (an ad blocker) or unreachable: the direct link carries every tap from here
    tagState = "failed";
  };
  document.head.appendChild(el);
}

/** Is an element carrying an ENABLED spot rendered and inside the viewport right now? */
export function enabledSpotOnScreen(p: PublicSpotPopunder): boolean {
  for (const el of document.querySelectorAll(`[${AD_SPOT_ATTRIBUTE}]`)) {
    if (!p.spots.includes(el.getAttribute(AD_SPOT_ATTRIBUTE) as DirectLinkSpot)) continue;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && (!vh || r.top < vh) && (!vw || r.left < vw)) return true;
  }
  return false;
}

let watching = false;
/**
 * Load the tag the moment an enabled spot is on screen: checked now, then on DOM changes and scrolls until it loads.
 * Always against the CURRENT config (`popunder`), never the one this watch began with: a spot the admin switched off
 * meanwhile no longer loads it, and a pop-under switched off entirely ends the watch (code review, 2026-10-30).
 */
function watchForVisibleSpot(): void {
  const p = popunder;
  if (!p || tagState !== "idle" || watching) return;
  if (enabledSpotOnScreen(p)) {
    loadTag(p);
    return;
  }
  if (typeof MutationObserver === "undefined") return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const live = popunder;
      if (tagState !== "idle" || !live) return stop();
      if (enabledSpotOnScreen(live)) {
        stop();
        loadTag(live);
      }
    }, 400);
  };
  const mo = new MutationObserver(check);
  const stop = () => {
    mo.disconnect();
    window.removeEventListener("scroll", check, true);
    watching = false;
  };
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", check, { capture: true, passive: true });
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

/**
 * Warm the CONNECTION to an ad's first hop before the tap (owner, 2026-10-26: "prefetch the adsterra smartlink and pop
 * under … so it opens the page instantly"): a DNS lookup + TLS handshake to the link's own host, done once per origin,
 * so the tap's new tab skips the slowest part of its first request.
 *
 * 🔴 Deliberately NOT the link itself. Fetching or prerendering a Smartlink before anyone taps it is a visit nobody
 * made — the network sees an impression without a person, which is exactly what invalid-traffic filters (and account
 * bans) look for, and it would burn the click the member is about to make. A preconnect sends no request to the ad.
 */
const warmed = new Set<string>();
function preconnect(url: string | null | undefined): void {
  // a hint only: nothing here may ever stand between a tap and its ad
  try {
    if (!url || typeof document === "undefined" || !document.head) return;
    const origin = new URL(url, window.location.href).origin;
    if (!origin.startsWith("https://") || warmed.has(origin) || origin === window.location.origin) return;
    warmed.add(origin);
    for (const rel of ["dns-prefetch", "preconnect"]) {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = origin;
      if (rel === "preconnect") link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  } catch {
    /* no hint, same ad */
  }
}

export async function loadDirectLinkOpener(spot: DirectLinkSpot): Promise<SpotOpener | null> {
  const d = (await loadAdsConfig()) as Record<string, unknown> | null;
  type Link = { url: string; spots: string[]; chancePercent: number };
  const usableHere = (c: Link | null | undefined) => (c && c.spots?.includes(spot) && isValidDirectLinkUrl(c.url) ? c : null);
  const direct = usableHere(d?.monetagDirectLink as Link | null | undefined);
  // the Adsterra Smartlink (2026-10-24): a SEPARATE backup, tried only when the Monetag link did not open on this tap
  const smart = usableHere(d?.adsterraSmartlink as Link | null | undefined);
  const links = [direct, smart].filter((l): l is Link => !!l);
  const pu = d?.monetagSpotPopunder as PublicSpotPopunder | null | undefined;
  const popunderOn = !!pu && Array.isArray(pu.spots) && typeof pu.src === "string" && /^https:\/\//.test(pu.src);
  // switched off since its tag loaded (at any spot): disarm it everywhere; switched back on: the gate follows the config.
  // A failed read answers {} — that is "unknown", never "off", so it changes nothing.
  const configRead = !!d && Object.keys(d).length > 0;
  if (configRead && !popunderOn) disarmLoadedPopunder();
  else if (popunderOn && tagState !== "idle") openGateFor(pu!);
  /*
    The page-wide pop-under follows EVERY fresh read, not only reads from a spot it is on (code review, 2026-10-30): it
    was replaced only when this spot was in the new list, so a spot the admin took off (the pop-under itself left on)
    kept the old list here — the press handler still armed it there, and the X the admin had just switched off opened
    the pop-under anyway. A failed read ({}) changes nothing, as above.
  */
  if (popunderOn) popunder = pu!;
  const spotPopunder = popunderOn && pu!.spots.includes(spot) ? pu! : null;
  if (!links.length && !spotPopunder) return null;
  // the connections are ready before the tap — the link's host and the pop-under script's host (no request to either ad)
  for (const l of links) preconnect(l.url);
  preconnect(spotPopunder?.src);
  if (spotPopunder) {
    if (!pressListening) {
      pressListening = true;
      window.addEventListener("pointerdown", onPress, true);
    }
    // ready BEFORE the first tap (a tag loaded by the tap itself arrives too late to open on it) — but only once an
    // enabled spot is really ON SCREEN: the ad close X lives in components mounted on most pages, and loading on mount
    // put Monetag everywhere (owner, 2026-10-23: "opens everywhere even in history")
    window.setTimeout(watchForVisibleSpot, POPUNDER_PRELOAD_MS);
  }

  /**
   * The backups, in order: the Monetag link, then the Adsterra Smartlink — each rolls its own chance; the FIRST that wins
   * opens in a new tab and nothing else does on this tap. A late pop-under is refused for a moment after.
   */
  const openDirect = (): boolean => {
    for (const link of links) {
      if (!directLinkRollWins(link.chancePercent, Math.random())) continue;
      openOwnWindow(link.url);
      suppressForeignOpens(LATE_POPUNDER_MS);
      return true;
    }
    return false;
  };

  return (onOutcome) => {
    if (!spotPopunder || tagState !== "ready") {
      // no pop-under here yet (not set up, the first press is loading it, or it was blocked): the direct link, in the tap
      const opened = openDirect();
      onOutcome?.(spotOutcome({ popunderOpened: false, directOpened: opened }));
      return links.length > 0;
    }
    if (coolingDown(spotPopunder)) {
      /*
        A pop-under showed a short while ago, so none may open now (the gate refuses it). The tap still gets its BACKUP —
        the direct link / Smartlink, each on its own chance — exactly as when no pop-under is set up. Owner, 2026-10-27:
        "the adsterra smartlink and pop under is not counting … so I get low impression": every tap inside the
        cooldown (30 min by default) used to open NOTHING, Smartlink included. One ad per tap still holds.
      */
      const opened = openDirect();
      onOutcome?.(spotOutcome({ popunderOpened: false, directOpened: opened }));
      return links.length > 0;
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
