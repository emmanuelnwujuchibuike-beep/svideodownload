"use client";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";

import { loadProvider } from "./exoclick-sticky";

/**
 * ExoClick's FULLPAGE INTERSTITIAL, for every interstitial moment in the app.
 *
 * Owner, 2026-08-31: "set up the full idle, backswipe and all interstitial ad
 * to also use this exoclick interstitial ad set up for full page interstitial
 * ad", with the tag:
 *
 *     <script async src="https://a.pemsrv.com/ad-provider.js"></script>
 *     <ins class="eas6a97888e33" data-zoneid="6016704"></ins>
 *     <script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>
 *
 * ── This is a DIFFERENT PRODUCT from the VAST interstitial ───────────────────
 *
 * The existing interstitial fetches a VAST document, parses it, and plays the
 * creative in an overlay we own — our own skip timer, our own close button, our
 * own gate. This one is a DISPLAY unit: the network's loader takes over the page
 * itself and owns the whole experience, including whatever skip control it
 * decides to show.
 *
 * So there is deliberately no overlay, no player and no skip UI here. Building
 * one would mean drawing our chrome around a takeover we do not control and
 * cannot measure — the same mistake as styling the `<ins>` the creative never
 * goes into. What we own is WHEN it is allowed to fire; the rest is theirs.
 *
 * The class suffix says which product it is: `K()` in their bundle reads
 * `parseInt(class.substring(11))` as the zone type, so `eas6a97888e33` is type
 * 33 (fullpage interstitial) where the history banner's `…37` is outstream
 * video. That is also why the tag's own provider domain is honoured rather than
 * ours — this zone was activated against `pemsrv`, not `magsrv`.
 *
 * ── What this module does NOT decide ─────────────────────────────────────────
 *
 * Nothing about frequency, cooldown or which moments are eligible. All of that
 * already exists in `vast-interstitial/request.ts` — one session at a time, a
 * cooldown, a master switch, per-moment switches — and this is called from
 * inside it so every one of those still applies. Two placements with two
 * independent ideas of "not too often" is how a visitor meets two full-screen
 * ads in a row.
 */

/** Memoised public config — fetched at most once per page load. */
let tagPromise: Promise<ExoClickStickyTag | null> | null = null;

function loadTag(): Promise<ExoClickStickyTag | null> {
  tagPromise ??= fetch("/api/ads/config")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { exoclickInterstitial?: ExoClickStickyTag | null }) => d.exoclickInterstitial ?? null)
    .catch(() => null);
  return tagPromise;
}

/**
 * Report the outcome to the operator feed.
 *
 * A real fill needs an authorised referer, so this cannot be exercised on
 * localhost at all — which is exactly why the answer has to be readable from
 * production. Without it, "the interstitial never appeared" and "the network
 * had nothing for this visitor" are the same observation.
 */
function beacon(filled: boolean): void {
  try {
    navigator.sendBeacon?.(
      "/api/track",
      new Blob(
        [JSON.stringify({ kind: "banner", slot: "interstitial", filled, path: location.pathname })],
        { type: "application/json" },
      ),
    );
  } catch {
    /* Diagnostics must never break the thing they describe. */
  }
}

/**
 * How long to wait for the network to put something on screen.
 *
 * A ceiling on WAITING, not on the ad's life. There is deliberately no
 * teardown timer any more: the host is armed once for the page and their
 * script owns the takeover, including when to show and close it.
 */
const FILL_TIMEOUT_MS = 6000;

/**
 * Ask ExoClick for a fullpage interstitial. Resolves `true` only if something
 * actually rendered.
 *
 * Always resolves, never throws, and never blocks the caller for longer than
 * the fill timeout — an ad is an enhancement to whatever the visitor was doing,
 * never a step in it.
 */
/**
 * The armed host, created at most ONCE per page.
 *
 * 🔴 ARM IT AND LEAVE IT ARMED — NEVER DELETE IT (production evidence,
 * 2026-08-31: `scripts/exoclick-interstitial-gesture.mjs`).
 *
 * Their zone DOES return an ad — `s.pemsrv.com` answers
 * `{"idzone":6016704,"type":"mobile_fullpage_interstitial","data":{…}}` — and
 * their script injects the overlay into our host:
 *
 *     DIV.ex-over-top  pos=fixed  display:none  z=2147483647
 *
 * `display: none` is not a no-fill. It is ARMED: the markup is there, styled,
 * at the maximum z-index, waiting for the moment THEIR script picks. The probe
 * left it armed through six idle seconds, two real taps and a scroll and it
 * stayed hidden, so that moment is not something we can ask for.
 *
 * What the old code did was fatal to it: wait 6s, see nothing painted, call
 * `host.remove()`. Every attempt therefore threw away the armed overlay and fell
 * through to the VAST video — the owner's "the main interstitial ad doesnt show,
 * rather is the video i used as interstilla before that i already removed".
 *
 * So the host is a page-lifetime singleton. Arming is idempotent, it is never
 * torn down, and their script keeps its standing chance to fire.
 */
let armedHost: HTMLElement | null = null;

/** Is a fullpage overlay actually ON SCREEN right now (ours or theirs)? */
function overlayVisible(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(".ex-over-top, [id^='ad_'][class*='ex-over']")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    if (r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.6) return true;
  }
  return false;
}

export async function showExoClickInterstitial(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  const tag = await loadTag();
  if (!tag) return false;

  /*
    Already showing from an earlier arming — their script picked this moment.
    Report it so the caller does not stack a second interstitial on top.
  */
  if (overlayVisible()) return true;

  if (!armedHost) {
    /*
      A host we own. The unit positions ITSELF — the loader's fullpage ad types
      are handled specially in their bundle — so this element must add no box of
      its own and must not constrain what is put in it.
    */
    const host = document.createElement("div");
    host.setAttribute("data-exoclick-interstitial", "");
    document.body.appendChild(host);

    const ins = document.createElement("ins");
    /*
      Only the network's class. Their `K()` derives the zone TYPE from this exact
      attribute, so anything appended to it is being fed to their parser.
    */
    ins.className = tag.cls;
    ins.setAttribute("data-zoneid", tag.zoneId);
    host.appendChild(ins);
    armedHost = host;

    const ok = await loadProvider(tag.src ?? EXOCLICK_PROVIDER_SRC);
    if (!ok) {
      /*
        Blocked or unreachable — nothing was ever armed, so there is nothing to
        preserve and the host would be an empty orphan.
      */
      host.remove();
      armedHost = null;
      beacon(false);
      return false;
    }

    try {
      (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
    } catch {
      host.remove();
      armedHost = null;
      beacon(false);
      return false;
    }
  }

  /*
    Did a takeover actually get PUT ON SCREEN inside the window we can wait?

    Measured, never pattern-matched — the same rule the banner detection had to
    learn the hard way. `overlayVisible()` asks only for a fixed element covering
    most of the viewport, which is what a fullpage interstitial IS, wherever
    their script chose to attach it.
  */
  const shown = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (overlayVisible()) return resolve(true);
      if (Date.now() - started >= FILL_TIMEOUT_MS) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });

  beacon(shown);

  if (!shown) {
    /*
      🔴 LEAVE IT ARMED. Do NOT remove the host.

      "Not on screen within six seconds" is not "no ad": the overlay is injected
      and waiting for a moment their script picks, and deleting it is what turned
      every interstitial moment into the VAST video fallback. It stays in the
      document for the rest of the page's life, at zero layout cost — `.ex-over-top`
      is `position: fixed` and `display: none` — so it can still fire later, and
      the next call sees it through `overlayVisible()` rather than arming a second.

      The caller falls back to its VAST interstitial for THIS moment, which is
      the honest outcome: the reader gets an ad now, and ExoClick keeps its
      standing chance.
    */
    return false;
  }

  /*
    The network owns the takeover from here — including closing it.

    Nothing is scheduled to tear the host down any more. It used to be reclaimed
    on a `MAX_LIFETIME_MS` ceiling, which was written for a host that was rebuilt
    on every attempt; now that the host is armed once for the page, that timer
    would delete the standing placeholder and any overlay their script had put in
    it. `.ex-over-top` is `position: fixed`, so a dormant one costs no layout.
  */
  return true;
}

/**
 * Test/debug seam — resets the module singletons.
 *
 * Drops the armed host too, or a test that arms an interstitial leaks it into
 * the next one and the second arming is skipped as "already armed".
 */
export function __resetExoClickInterstitial(): void {
  tagPromise = null;
  armedHost?.remove();
  armedHost = null;
}
