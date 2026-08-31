"use client";

import { showAdsFromCache } from "@/features/auth/use-entitlements";
import { track } from "@/lib/analytics/client";
import type { VastCreative } from "@/lib/monetization/vast";
import {
  DEFAULT_VAST_INTERSTITIAL,
  normalizeVastInterstitial,
  type VastInterstitialConfig,
} from "@/lib/monetization/vast-interstitial";

/**
 * `requestVastInterstitial()` — the whole public surface of the ad interstitial.
 *
 * ── The architecture, stated once ─────────────────────────────────────────────
 *
 *     download flow = primary
 *     interstitial  = optional enhancement
 *
 * NOT "wait for ExoClick, then maybe download". Every branch below resolves,
 * none reject, and the caller is expected to `void` this and carry on. A caller
 * that awaits it still gets a bounded wait, because the startup budget is the
 * only thing that can delay them.
 *
 * ── Why nothing here is on the critical path ──────────────────────────────────
 *
 * This module is only ever reached through a dynamic `import()` from a click
 * handler (see `downloader.tsx`). On a cold page load nothing in this file is
 * parsed, no config is fetched, no VAST request is made and no video element
 * exists. The overlay — the heaviest part, React + a player — is a SECOND
 * dynamic import that only happens once a creative is actually in hand, so an
 * empty or failed ad never costs the visitor the player bundle either.
 */

type Phase = "idle" | "loading" | "playing";

/** One session at a time, per tab. The guard against duplicate ads. */
let phase: Phase = "idle";
/** When the last interstitial finished, for the cooldown. */
let lastShownAt = 0;
/** Memoised public config — fetched at most once per page load. */
let configPromise: Promise<VastInterstitialConfig> | null = null;

async function loadConfig(): Promise<VastInterstitialConfig> {
  configPromise ??= fetch("/api/ads/config")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { vastInterstitial?: unknown }) => normalizeVastInterstitial(d.vastInterstitial))
    /*
      A failed config read must not block a download, and must not silently
      enable an intrusive placement either — so it falls back to the DEFAULTS,
      whose `enabled` is false.
    */
    .catch(() => DEFAULT_VAST_INTERSTITIAL);
  return configPromise;
}

/**
 * Which moment is asking. Each has its own admin switch and its own ad zone, so
 * an operator can run the completion ad without the start ad (the default) and
 * price the two zones separately.
 *
 * `ambient` is idle + back-swipe (triggers.tsx). It is gated by the MASTER
 * switch alone: it used to ride on `enabledOnDownload`, which was already a
 * misnomer, and would now switch itself off with that field's new default —
 * silently removing two placements nobody asked to remove.
 */
export type InterstitialTrigger = "download" | "download-complete" | "ambient";

/** The zone each moment serves from. Reuses the existing zone registry. */
const ZONE_BY_TRIGGER: Record<InterstitialTrigger, string> = {
  download: "download_preparing",
  "download-complete": "download_complete",
  ambient: "download_preparing",
};

function isEnabledFor(config: VastInterstitialConfig, trigger: InterstitialTrigger): boolean {
  if (!config.enabled) return false;
  if (trigger === "download") return config.enabledOnDownload;
  if (trigger === "download-complete") return config.enabledOnDownloadComplete;
  return true;
}

export interface InterstitialResult {
  shown: boolean;
  reason: "shown" | "disabled" | "cooldown" | "busy" | "no-ad" | "timeout" | "error";
}

/**
 * Try to show a full-screen ad. Always resolves, never throws, never blocks
 * longer than the configured startup budget.
 */
export async function requestVastInterstitial(
  trigger: InterstitialTrigger = "download",
): Promise<InterstitialResult> {
  // Duplicate guard: two Download taps, a batch finishing eight files at once,
  // or a double-fire must not open two overlays or make two VAST requests.
  if (phase !== "idle") return { shown: false, reason: "busy" };

  /*
    🔴 PAYING MEMBERS NEVER SEE THIS.

    Every other placement is gated server-side — `/api/ads/*` refuses to serve
    to a premium plan — but ExoClick's fullpage unit is a pasted tag their own
    loader fills in the browser, so no server sits between it and the visitor.
    Without this check, upgrading would remove every ad in the product except
    the most intrusive one.

    Read from the entitlement cache rather than a hook: this is a plain async
    function called from a timer. It defaults to "show ads" while the cache is
    cold, which is right here — these moments fire tens of seconds into a visit,
    long after `/api/me` has answered.
  */
  if (!showAdsFromCache()) return { shown: false, reason: "disabled" };

  let config: VastInterstitialConfig;
  try {
    config = await loadConfig();
  } catch {
    return { shown: false, reason: "error" };
  }

  /*
    The cooldown is shared: it is a promise to the VISITOR about how often a
    full-screen ad may appear, not a property of whichever product supplies it.
  */
  if (config.cooldownMs > 0 && Date.now() - lastShownAt < config.cooldownMs) {
    return { shown: false, reason: "cooldown" };
  }

  /*
    🔴 EXOCLICK'S FULLPAGE INTERSTITIAL IS GATED BY ITS OWN TAG, AND NOTHING
    ELSE (owner, 2026-08-31: "you did not do the main exoclick interstitial ad
    zone, cause is not showing anything").

    It WAS implemented — the settings key, the admin field, the config route and
    this call all shipped — and it could still never run, because this block sat
    BELOW `isEnabledFor(config, …)`. That is the VAST interstitial's master
    switch, it defaults to OFF, and the owner had turned it off precisely
    BECAUSE they were removing the video interstitial it controls. So switching
    products off switched the replacement off with it, and the feature looked
    unbuilt.

    A placement with its own settings key must not require another product's
    switch. The ExoClick attempt now happens BEFORE any VAST gating: pasting the
    tag is the whole activation, which is what the admin field says it is. The
    VAST switches are checked further down, where they belong — on the VAST
    path.

    The guards that survive are the ones about the VISITOR rather than about a
    product: the busy check above (one full-screen ad at a time) and the
    cooldown.
  */
  /*
    Claimed BEFORE the await, not after. The busy guard at the top of this
    function is the only thing stopping a batch finishing eight files at once
    from opening eight takeovers, and an `await` with `phase` still "idle" is a
    hole straight through it.
  */
  phase = "loading";
  try {
    const { showExoClickInterstitial } = await import("../exoclick-interstitial");
    const outcome = await showExoClickInterstitial();
    /*
      🔴 A CONFIGURED PLACEMENT IS NOT A FALLBACK (owner, 2026-08-31: "the
      interstitial is not showing after 5secs, rather is the video i used as
      interstitial before that i already removed that shows").

      Only `no-tag` continues to the VAST path. `empty` deliberately does NOT:
      once an ExoClick tag is pasted, this moment belongs to ExoClick, and
      falling through would run the old video interstitial the operator had
      already removed — which is exactly what was happening, because "did it
      fill" is measured against markup we do not control and a MISS is
      indistinguishable from a genuine no-fill. Showing a removed ad because our
      detector was unsure is worse than showing nothing.

      `lastShownAt` is stamped even on `empty`, so an ExoClick attempt still
      spends the cooldown. Otherwise a zone that is out of inventory would let
      every idle timeout re-ask immediately, which is a request loop with a
      full-screen ad at the end of it.
    */
    if (outcome !== "no-tag") {
      lastShownAt = Date.now();
      phase = "idle";
      return outcome === "shown"
        ? { shown: true, reason: "shown" }
        : { shown: false, reason: "no-ad" };
    }
  } catch {
    /* The module itself failed to load — fall through to the VAST path. */
  }

  /*
    The VAST product's own switches, checked HERE rather than at the top — they
    govern the VAST interstitial and must not decide whether ExoClick's separate
    placement above is allowed to run. `phase` is released first: the ExoClick
    attempt claimed it, and a disabled VAST path must not leave the module stuck
    in "loading" and refuse every later request as busy.
  */
  if (!isEnabledFor(config, trigger)) {
    phase = "idle";
    return { shown: false, reason: "disabled" };
  }

  const ZONE = ZONE_BY_TRIGGER[trigger];

  phase = "loading";
  const controller = new AbortController();
  /*
    THE STARTUP BUDGET. It covers fetching the VAST and getting the first frame
    playing — nothing more. Once playback has started the timer is irrelevant
    and the visitor watches the real ad; before that, every failure mode
    (unreachable, empty, slow, blocked autoplay) lands here and the download
    continues. `abort()` also cancels the in-flight request so an abandoned
    attempt cannot linger.
  */
  const budget = setTimeout(() => controller.abort(), config.timeoutMs);

  track("vast_requested", { zone: ZONE });

  try {
    const res = await fetch(`/api/ads/exoclick?zone=${encodeURIComponent(ZONE)}`, {
      signal: controller.signal,
    });
    const creative: VastCreative | null = res.ok ? ((await res.json()).ad ?? null) : null;

    if (!creative?.mediaUrl) {
      clearTimeout(budget);
      phase = "idle";
      track("vast_error", { zone: ZONE, reason: "no-ad" });
      return { shown: false, reason: "no-ad" };
    }
    track("vast_loaded", { zone: ZONE });

    // The heavy half — React overlay + player — loads ONLY now, with a creative
    // already in hand. An empty zone never costs this bundle.
    const { showInterstitial } = await import("./overlay");
    phase = "playing";

    const outcome = await showInterstitial({
      creative,
      config,
      startSignal: controller.signal,
      onStarted: () => clearTimeout(budget),
    });

    clearTimeout(budget);
    lastShownAt = Date.now();
    phase = "idle";
    return { shown: outcome === "completed" || outcome === "skipped", reason: "shown" };
  } catch (err) {
    clearTimeout(budget);
    phase = "idle";
    const aborted = err instanceof DOMException && err.name === "AbortError";
    track(aborted ? "vast_timeout" : "vast_error", { zone: ZONE });
    return { shown: false, reason: aborted ? "timeout" : "error" };
  }
}

/** Test/debug seam — resets the module singleton. */
export function __resetInterstitial(): void {
  phase = "idle";
  lastShownAt = 0;
  configPromise = null;
}
