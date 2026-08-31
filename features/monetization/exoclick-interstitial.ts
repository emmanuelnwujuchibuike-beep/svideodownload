"use client";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";

import { debugMessages, loaderError, loaderVerdict } from "@/lib/monetization/exoclick-verdict";

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
function beacon(state: "requested" | "filled" | "empty", reason?: "no-ads" | "timeout" | "blocked", detail?: string | null): void {
  try {
    navigator.sendBeacon?.(
      "/api/track",
      new Blob(
        [JSON.stringify({ kind: "banner", slot: "interstitial", state, filled: state === "filled", reason, detail: detail ?? undefined, path: location.pathname })],
        { type: "application/json" },
      ),
    );
  } catch {
    /* Diagnostics must never break the thing they describe. */
  }
}

/** How long to wait for the network to put something on screen. */
const FILL_TIMEOUT_MS = 6000;
/** How long a takeover may stay before the host is reclaimed. */
const MAX_LIFETIME_MS = 90_000;

/**
 * What happened when we asked.
 *
 * 🔴 THREE STATES, NOT A BOOLEAN, and the distinction is the whole point
 * (owner, 2026-08-31: "the interstitial is not showing after 5secs, rather is
 * the video i used as interstitial before that i already removed that shows").
 *
 * This used to return `false` both when no tag was configured AND when a
 * configured tag did not visibly fill, and the caller treated both as "fall
 * back to the VAST interstitial". So an operator who had switched this
 * placement to ExoClick still got the old video interstitial they had removed —
 * and worse, they got it INSTEAD of an ExoClick takeover that may well have
 * rendered, because "did it fill" is measured against markup we do not control
 * and a miss is indistinguishable from a no-fill.
 *
 * `no-tag` is the only answer that means "this placement is not configured, use
 * the fallback". Once a tag exists, this placement belongs to ExoClick and the
 * fallback must not run behind its back.
 */
export type InterstitialOutcome = "no-tag" | "shown" | "empty";

/**
 * Ask ExoClick for a fullpage interstitial.
 *
 * Always resolves, never throws, and never blocks the caller for longer than
 * the fill timeout — an ad is an enhancement to whatever the visitor was doing,
 * never a step in it.
 */
export async function showExoClickInterstitial(): Promise<InterstitialOutcome> {
  if (typeof document === "undefined") return "no-tag";

  const tag = await loadTag();
  if (!tag) return "no-tag";

  /*
    A host we own and can remove. The unit positions ITSELF — the loader's
    fullpage ad types are handled specially in their bundle — so this element
    must add no box of its own and must not constrain what is put in it.
  */
  /*
    🔴 REPORT THE ASK, NOT ONLY THE ANSWER.

    "Is it even being requested?" has been the open question for two rounds, and
    nothing on our side could answer it: a placement that never fires and one
    the network declines both look like an empty screen. This row is the
    difference, and it is emitted before anything can go wrong afterwards.
  */
  beacon("requested");

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

  const cleanup = () => host.remove();

  const ok = await loadProvider(tag.src ?? EXOCLICK_PROVIDER_SRC);
  if (!ok) {
    cleanup();
    beacon("empty", "blocked");
    return "empty";
  }

  try {
    (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
  } catch {
    cleanup();
    beacon("empty", "blocked");
    return "empty";
  }

  /*
    Did anything actually render? Measured, never pattern-matched on markup we
    do not control — the same rule the banner detection had to learn. A fullpage
    unit may attach itself to `body` rather than to our host, so BOTH are
    checked: our host gaining height, or the document gaining a new fixed,
    full-viewport element that was not there before.
  */
  const logStart = debugMessages().length;
  const before = new Set(document.body.children);
  const filled = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const check = () => {
      if (host.offsetHeight > 0) return true;
      for (const el of document.body.children) {
        if (before.has(el) || el === host) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.6) return true;
      }
      return false;
    };
    const tick = () => {
      if (check()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= FILL_TIMEOUT_MS) {
        resolve(false);
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });

  /*
    The loader-s own answer when it has one, so "empty" is not a dead end: an
    ExoClick refusal and a request that never came back need different fixes.
  */
  const verdict = loaderVerdict(tag.zoneId, logStart);
  beacon(
    filled ? "filled" : "empty",
    filled ? undefined : verdict === "empty" ? "no-ads" : "timeout",
    filled || verdict !== "empty" ? null : loaderError(tag.zoneId, logStart),
  );

  /*
    🔴 A NO-FILL VERDICT MUST NOT DELETE THE PLACEHOLDER (owner, 2026-08-31:
    "the interstitial is not showing").

    This used to `cleanup()` here — `host.remove()`, which takes the `<ins>` and
    everything the loader put beside it out of the document. So if ExoClick's
    fullpage unit rendered even a moment after the six-second window, or
    rendered into a structure the detector does not recognise, WE DELETED THE
    AD. A detector that is unsure was tearing down the very thing it was unsure
    about, and the symptom is precisely "nothing shows".

    The verdict is telemetry, not a decision. An unfilled `<ins>` and its empty
    wrapper occupy no space and cost nothing to leave in place, so they stay,
    and a takeover that arrives late still appears. Only the long lifetime
    ceiling below ever removes the host — and it is far longer than any
    interstitial should live, so it cannot cut a real ad short either.

    The RETURN value is still honest: `empty` means we did not see it render,
    which is what the caller needs to know to avoid stacking a second ad on top.
  */
  setTimeout(cleanup, MAX_LIFETIME_MS);
  if (!filled) return "empty";
  return "shown";
}

/** Test/debug seam — resets the module singleton. */
export function __resetExoClickInterstitial(): void {
  tagPromise = null;
}
