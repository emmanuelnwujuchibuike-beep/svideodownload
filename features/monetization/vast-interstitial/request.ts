"use client";

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
/**
 * When each MOMENT last showed an interstitial.
 *
 * 🔴 PER TRIGGER, AND THAT IS A REGRESSION FIX (owner, 2026-09-01: "the download
 * completed vast doesnt show anymore or triggers more late now").
 *
 * It was a single number shared by every trigger, which was fine while only the
 * download moments used this function. Then idle/back-swipe and the history
 * story ad were routed through it too — so with `cooldownMs` at five minutes, an
 * idle ad on any page consumed the cooldown for ALL of them and the
 * download-complete interstitial was suppressed for the next five minutes. The
 * moment the owner cares most about became the one least likely to fire, and I
 * caused that by adding consumers to a shared budget.
 *
 * Each moment now keeps its own clock, so a frequently-reached one cannot starve
 * a rare one.
 */
const lastShownAt = new Map<InterstitialTrigger, number>();

/**
 * A floor between ANY two interstitials, whatever their moments.
 *
 * Deliberately TINY (owner, 2026-09-01: "all hiltop vast video should not have
 * cooldown, so a user who downloads repeated can always see the interstilla and
 * download completed").
 *
 * A download start and its own completion are seconds apart and the owner wants
 * BOTH, so this cannot be a real gap. It exists only so two overlays cannot
 * stack in the same instant — and the `phase` guard above already covers the
 * concurrent case, which makes this a belt to that braces rather than a policy.
 * The real frequency control is `cooldownMs`, which is admin-set and can be 0.
 */
const BACK_TO_BACK_MS = 3_000;
let lastAnyShownAt = 0;
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
export type InterstitialTrigger =
  | "download"
  | "download-complete"
  | "ambient"
  /**
   * The full-screen ad between saved media on the History page, after every N
   * items (owner, 2026-09-01: "history view after 3 view is showing banner
   * instead of vast that shows on interstilla").
   *
   * It is here rather than in `AdSlot` because AdSlot HAS NO VIDEO BRANCH — a
   * video row there resolves, reports itself present and paints nothing. The
   * story slide wanted the same video the interstitial plays, and this module is
   * the only thing that plays one.
   *
   * Gated by the master switch alone, like `ambient`: it is not a download
   * moment, so neither download flag describes it.
   */
  | "history-story"
  /**
   * The wallpaper download gate (owner, 2026-09-01: "the wallpaper download
   * started and completed is suppose to be hiltop vast video and not hiltop
   * banner, cause now it only shows a 5sec hiltop banner").
   *
   * Same reason as `history-story`: the gate rendered through AdSlot, which has
   * no video branch, so it could only ever show the banner the owner is
   * describing.
   */
  | "wallpaper"
  /**
   * An IN-PAGE position that has been scrolled to — the history period
   * separators and the landing section breaks.
   *
   * Owner, 2026-09-01: "the vast video shown on download completed should be
   * used as general interstilla and not hiltop banner, same for the landing page
   * sections … in history today, yesterday, this week, last week, it should be
   * the vast video, only the first above the grid should be hiltop banner."
   *
   * 🔴 THE POSITION IS THE TRIGGER, NOT THE SURFACE. These slots cannot PLAY a
   * video — there is no in-page player — but reaching one is a moment, and a
   * moment can open the same full-screen VAST the download completion opens.
   * That is what "used as general interstilla" means.
   */
  | "in-page";

/** The zone each moment serves from. Reuses the existing zone registry. */
const ZONE_BY_TRIGGER: Record<InterstitialTrigger, string> = {
  download: "download_preparing",
  "download-complete": "download_complete",
  /*
    🔴 ITS OWN ZONE NOW (owner, 2026-09-01: "the idle interstilla shows more of
    banner and less of vast video").

    `ambient` is idle + back-swipe, and it was pointed at `download_preparing` —
    a DOWNLOAD zone. So the idle moment had two different paths answering it: the
    `IdleInterstitial` component rendering `idle_interstitial` through AdSlot,
    which can only paint a banner, and this one occasionally playing a video from
    a zone belonging to another moment. Mostly banner, sometimes video, exactly
    as reported.

    Both now resolve `idle_interstitial`, and the component stands down when that
    zone is set to `vast` — so the moment has ONE answer and the admin picker
    decides which.
  */
  ambient: "idle_interstitial",
  "history-story": "history_story_ad",
  wallpaper: "wallpaper_reward",
  "in-page": "landing_section_break",
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
/**
 * Warm everything the completion path would otherwise pay for.
 *
 * Owner, 2026-09-01: "the interstilla video also triggers on download complete
 * but triggers late, i want it to trigger early".
 *
 * 🔴 THE LATENESS IS THREE MODULE FETCHES AND A CONFIG ROUND TRIP, ALL AFTER THE
 * FILE HAS ALREADY SAVED. Counted from the completion event, the old path was:
 *
 *   1. `import("./request")`            — this module, fetched on demand
 *   2. `loadConfig()`                   — /api/ads/config
 *   3. `import("../exoclick-interstitial")`
 *   4. `fetch("/api/ads/exoclick?zone=…")` — the VAST, wrappers followed server-side
 *   5. `import("./overlay")`
 *   6. the media file itself
 *
 * Only 4 and 6 have to happen at the moment of the download. Steps 1, 2, 3 and 5
 * are the same bytes every time and can be in hand long before, which is what
 * this does — on an IDLE callback, so nothing about it competes with the page
 * load or the download itself.
 *
 * Deliberately does NOT prefetch the VAST. A creative fetched early is an
 * impression counted early, and one requested on every page view rather than on
 * every completed download would misreport the placement and burn the viewer's
 * frequency cap on moments that never happened.
 */
export function warmVastInterstitial(): void {
  void loadConfig().catch(() => {
    /* Warming must never surface an error — the real path re-tries. */
  });
  void import("./overlay").catch(() => {});
  void import("../exoclick-interstitial").catch(() => {});
}

export async function requestVastInterstitial(
  trigger: InterstitialTrigger = "download",
): Promise<InterstitialResult> {
  // Duplicate guard: two Download taps, a batch finishing eight files at once,
  // or a double-fire must not open two overlays or make two VAST requests.
  if (phase !== "idle") return { shown: false, reason: "busy" };

  let config: VastInterstitialConfig;
  try {
    config = await loadConfig();
  } catch {
    return { shown: false, reason: "error" };
  }

  if (!isEnabledFor(config, trigger)) return { shown: false, reason: "disabled" };
  if (Date.now() - lastAnyShownAt < BACK_TO_BACK_MS) {
    return { shown: false, reason: "cooldown" };
  }
  if (config.cooldownMs > 0 && Date.now() - (lastShownAt.get(trigger) ?? 0) < config.cooldownMs) {
    return { shown: false, reason: "cooldown" };
  }

  /*
    🔴 EXOCLICK'S OWN FULLPAGE INTERSTITIAL FIRST (owner, 2026-08-31: "set up
    the full idle, backswipe and all interstitial ad to also use this exoclick
    interstitial ad set up for full page interstitial ad").

    Wired HERE rather than into each trigger, because this function is already
    the single door every interstitial moment goes through — idle and back-swipe
    (`ambient`), the download start and the download completion. One edit
    therefore covers all of them, and, far more importantly, they keep sharing
    ONE set of guards: the busy check above, the cooldown, the master switch and
    the per-moment switches. A second placement with its own idea of "not too
    often" is how a visitor meets two full-screen ads back to back.

    It is tried FIRST and the VAST path stays as the fallback, so an operator
    who has not pasted the tag loses nothing and one who has does not end up
    running both products at the same moment.

    `lastShownAt` is stamped on success so the cooldown covers this unit too —
    without it, an ExoClick takeover would not delay the next VAST one.
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
    if (await showExoClickInterstitial()) {
      lastShownAt.set(trigger, Date.now());
      lastAnyShownAt = Date.now();
      phase = "idle";
      return { shown: true, reason: "shown" };
    }
  } catch {
    /* No tag, a blocked loader, or no fill — fall through to the VAST path. */
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
    lastShownAt.set(trigger, Date.now());
    lastAnyShownAt = Date.now();
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
  lastShownAt.clear();
  lastAnyShownAt = 0;
  configPromise = null;
}
