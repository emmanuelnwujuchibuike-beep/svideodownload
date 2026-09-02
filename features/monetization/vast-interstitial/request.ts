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
  | "in-page"
  /**
   * The batch / HD / top-quality download, on the TAP (owner, 2026-09-01: "make
   * batch download and hd video selection to show the hiltop vast video on
   * clicking the downoad button instantly, and it shows again when the downloads
   * finishes").
   */
  | "batch"
  /**
   * The same download finishing.
   *
   * Its own trigger rather than reusing `download-complete`, for two reasons the
   * owner named: it must be able to fire even when the normal completion moment
   * just did, and it carries "a different timer in download complete hiltop vast
   * video interstilla, so it can be lower than normal download complete".
   */
  | "batch-complete";

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
  batch: "batch_download_gate",
  "batch-complete": "batch_download_complete",
};

/**
 * Triggers whose skip delay comes from their OWN admin number rather than the
 * interstitial's shared `skipAfterSeconds`.
 *
 * "batch download and hd and top quality should use a different timer in
 * download complete hiltop vast video interstilla, so it can be lower than
 * normal download complete interstilla time." Both numbers already existed —
 * `batchGateSeconds` and `batchCompleteSeconds` — and were being ignored by this
 * path, because the overlay reads one field for every moment.
 */
type SkipField =
  | "batchGateSeconds"
  | "batchCompleteSeconds"
  | "ambientSkipSeconds"
  | "completeAfterRewardSeconds";

/**
 * When a REWARD-style gate last actually played, if it has this page load.
 *
 * Owner, 2026-09-02: "when a download started reward video is shown, the
 * download completed video vast should [be] in a different lesser timer from
 * normal download completed 15secs timer."
 *
 * The completion ad has no idea what happened before it, and there is no
 * download id threaded through this module to ask with. What it does have is
 * time: a gate plays at the START of a download and the completion fires when
 * that same download lands, so a gate within the last few minutes is the same
 * download in every realistic case. Recording the instant is enough, and it
 * needs no new plumbing through six call sites.
 */
let rewardShownAt = 0;

/**
 * How long a played gate keeps discounting the completion ad.
 *
 * Long enough to cover a slow batch or a large file on a poor connection, short
 * enough that a gate watched half an hour ago is not still paying for an
 * unrelated download later in the session.
 */
const REWARD_DISCOUNT_WINDOW_MS = 10 * 60 * 1000;

/** Triggers that ARE the reward gate — the ones that unlock something. */
const REWARD_TRIGGERS = new Set<InterstitialTrigger>(["batch", "download"]);

const SKIP_FIELD_BY_TRIGGER: Partial<Record<InterstitialTrigger, SkipField>> = {
  batch: "batchGateSeconds",
  "batch-complete": "batchCompleteSeconds",
  /*
    The gesture moment is skippable sooner than the download ones (owner,
    2026-09-01: "it shouldnt be 15secs like others"). A download ad is the price
    of a file the visitor asked for; this one interrupts them doing nothing in
    particular, and the same hold is a very different bargain in the two cases.
  */
  ambient: "ambientSkipSeconds",
};

/**
 * Triggers with a cooldown of their OWN, overriding the shared one.
 *
 * "only those gesture alone alone should have a cooldown of 5minutes." Every
 * other moment follows `vastInterstitial.cooldownMs` — which is 0, so repeated
 * downloads always get their ad — while a gesture the visitor makes constantly
 * needs a real gap or it becomes a takeover every few seconds.
 */
const COOLDOWN_FIELD_BY_TRIGGER: Partial<Record<InterstitialTrigger, "ambientCooldownSeconds">> = {
  ambient: "ambientCooldownSeconds",
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
/**
 * A creative fetched ahead of the moment that will play it.
 *
 * 🔴 FETCHING THE VAST DOES NOT COUNT AN IMPRESSION, and an earlier note in this
 * file said otherwise. Impressions are fired by `pixel(creative.impression)` in
 * overlay.ts, at PLAYBACK — pulling the XML is a request, not a view. So a
 * creative can be in hand before it is needed without misreporting anything,
 * and the reason not to do it on every page view is simply that it would ask
 * for creatives on moments that never happen.
 *
 * Short TTL: a VAST response is targeted and time-limited, and a stale creative
 * is worse than a fresh fetch. Two minutes covers a download comfortably.
 */
const CREATIVE_TTL_MS = 120_000;
const creativeCache = new Map<string, { creative: unknown; at: number }>();

/**
 * Which START moment implies which COMPLETION moment(s) are seconds away.
 *
 * 🔴 `batch` WARMS BOTH, and that is not belt-and-braces — it is a correctness
 * fix. The top-quality gate reuses the `batch` trigger (one zone, one admin
 * timer), but a single-file HD download finishes through
 * `DOWNLOAD_COMPLETED_EVENT`, which fires `download-complete` — NOT
 * `batch-complete`. Warming only the batch completion left the HD path's
 * completion ad cold, which is the ~10.9s "late" all over again for exactly the
 * moment the owner asked to be instant. Whichever one actually fires is now
 * already in hand.
 */
const PREFETCHES_ON_START: Partial<Record<InterstitialTrigger, InterstitialTrigger[]>> = {
  download: ["download-complete"],
  wallpaper: ["download-complete"],
  batch: ["batch-complete", "download-complete"],
};

/**
 * Put the completion creative in hand while the download is still running.
 *
 * Owner, 2026-09-01: "make the download complete hiltop vast video interstills
 * to trigger more instant".
 *
 * The remaining wait after the module warm-up was one request to
 * /api/ads/exoclick, which fetches the tag, FOLLOWS WRAPPERS server-side and
 * parses the XML — the slowest step by a distance, and it was starting only
 * once the file had already saved.
 *
 * A download START is the honest moment to ask: a completion is seconds away,
 * so this is one request per download rather than one per page view, which is
 * the same number of requests the completion itself would have made.
 */
/**
 * One of the batch skip numbers from the public ad config.
 *
 * Read from the same cached endpoint the rest of this module uses, so it costs
 * no extra round trip in practice.
 */
async function loadSkipSeconds(
  field: SkipField | "ambientCooldownSeconds",
): Promise<number | null> {
  try {
    const d = await fetch("/api/ads/config").then((r) => (r.ok ? r.json() : {}));
    const value = (d as Record<string, unknown>)[field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function prefetchCreative(trigger: InterstitialTrigger): void {
  const zone = ZONE_BY_TRIGGER[trigger];
  if (!zone) return;
  void fetch(`/api/ads/exoclick?zone=${encodeURIComponent(zone)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const creative = d?.ad ?? null;
      if (!creative) return;
      creativeCache.set(zone, { creative, at: Date.now() });
      warmMedia(creative.mediaUrl);
    })
    .catch(() => {
      /* The real path re-requests — this is only a head start. */
    });
}

/** The warmer currently buffering a creative, so it can be torn down. */
let warmer: HTMLVideoElement | null = null;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 PREFETCHING THE VAST XML WAS NEVER THE SLOW PART
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `prefetchCreative` has always fetched the VAST DOCUMENT at download start,
 * and its own comment calls that "the slowest step by a distance". Measured, it
 * is not: the document is a few kB from our own origin. The MEDIA is the slow
 * part, and it was never warmed — so at completion the player still started a
 * cold multi-megabyte fetch that 302s to an IP-addressed CDN and comes back as
 * a 206. That is the ~10.9s cold start behind the zero-impression report.
 *
 * A hidden `preload="auto"` video is the warm that actually matches: it is the
 * SAME request the player will make (same URL, same mode, same range
 * behaviour), so the bytes land in the HTTP cache under the key the overlay's
 * own element will look up. A `fetch()` would not — it negotiates differently
 * and would risk a second, uncached download.
 *
 * The service worker passes cross-origin media straight to the network
 * (public/sw/routes.js: "Everything else — untouched"), so nothing here can
 * poison a cache entry.
 *
 * 🔴 BOUNDED, because this is also the Android memory path. Exactly ONE warmer
 * exists at a time, it is muted and never displayed, and it is torn down when
 * the creative is taken, when a new one replaces it, or after 60s if the
 * download never completes. An abandoned buffering video is precisely the kind
 * of retained media that hurts a low-RAM device.
 */
function warmMedia(url: string | undefined): void {
  if (!url || typeof document === "undefined") return;
  /* Saver mode means the visitor has asked us not to spend their data on
     speculative bytes. An ad is the definition of speculative. */
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;

  dropWarmer();
  try {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    // Never rendered, never audible, never a layout participant.
    v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
    v.setAttribute("aria-hidden", "true");
    document.body.appendChild(v);
    warmer = v;
    window.setTimeout(() => {
      if (warmer === v) dropWarmer();
    }, WARM_TTL_MS);
  } catch {
    /* Warming is an optimisation; it must never break the download path. */
  }
}

/** Release the warmer's buffer and its element. */
function dropWarmer(): void {
  const v = warmer;
  warmer = null;
  if (!v) return;
  try {
    // `removeAttribute("src")` + `load()` is what actually frees the buffered
    // media; removing the element alone can leave the decoder holding it.
    v.pause();
    v.removeAttribute("src");
    v.load();
    v.remove();
  } catch {
    /* nothing to do */
  }
}

/** How long a warmed creative may sit buffered before it is released. */
const WARM_TTL_MS = 60_000;

/** A cached creative for this zone, if one is in hand and still fresh. */
function takeCachedCreative(zone: string): unknown | null {
  const hit = creativeCache.get(zone);
  if (!hit) return null;
  creativeCache.delete(zone);
  /* The player is about to own this media, so the warmer's copy is now pure
     retained memory. Released here rather than on a timer so the handover has
     no window where two elements hold the same buffer. */
  dropWarmer();
  return Date.now() - hit.at < CREATIVE_TTL_MS ? hit.creative : null;
}

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

  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 THE PREFETCH HAPPENS BEFORE EVERY GUARD, ON PURPOSE
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-02: "download complete still trigger late."

    It was here — this warm-up used to sit BELOW the three returns underneath,
    so it only ran when the START moment itself went ahead. Any of `disabled`,
    the back-to-back window, or this trigger's own cooldown returned early and
    the COMPLETION creative was never requested and never warmed. The completion
    ad then started completely cold, and a cold Hilltop creative measures ~10.9s
    to first frame — which is exactly the "late" the owner is describing.

    Prefetching is not the same act as showing. It costs one request for a
    creative that is seconds away regardless of whether THIS moment is allowed
    to display anything, and its entire purpose is to make the NEXT moment
    instant. Gating it on the current moment's eligibility was the bug.
  */
  for (const follows of PREFETCHES_ON_START[trigger] ?? []) prefetchCreative(follows);

  if (!isEnabledFor(config, trigger)) return { shown: false, reason: "disabled" };
  /*
    🔴 A COMPLETION IS EXEMPT FROM THE BACK-TO-BACK WINDOW.

    The owner wants the start gate AND the completion ad for the same download,
    and those are seconds apart by definition — so a blanket 3s "nothing may
    follow anything" silently ate the completion ad on every fast download. The
    `phase` guard at the top already prevents two overlays existing at once,
    which is the only thing this window was ever really protecting against; its
    own comment calls it "a belt to that braces".
  */
  const isCompletion = trigger === "download-complete" || trigger === "batch-complete";
  if (!isCompletion && Date.now() - lastAnyShownAt < BACK_TO_BACK_MS) {
    return { shown: false, reason: "cooldown" };
  }
  /*
    This moment's own cooldown where it has one, otherwise the shared number.
    Read before the ad is requested so a moment still inside its gap costs
    nothing at all.
  */
  const ownCooldownField = COOLDOWN_FIELD_BY_TRIGGER[trigger];
  const cooldownMs = ownCooldownField
    ? ((await loadSkipSeconds(ownCooldownField)) ?? 300) * 1000
    : config.cooldownMs;
  if (cooldownMs > 0 && Date.now() - (lastShownAt.get(trigger) ?? 0) < cooldownMs) {
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
    /*
      A creative prefetched at download START, if one is waiting — that removes
      the whole request from the completion path, which is the slowest step in
      it. Falls straight through to the live fetch when there is none.
    */
    const cached = takeCachedCreative(ZONE) as VastCreative | null;
    const creative: VastCreative | null =
      cached ??
      (await (async () => {
        const res = await fetch(`/api/ads/exoclick?zone=${encodeURIComponent(ZONE)}`, {
          signal: controller.signal,
        });
        return res.ok ? ((await res.json()).ad ?? null) : null;
      })());

    if (!creative?.mediaUrl) {
      clearTimeout(budget);
      phase = "idle";
      track("vast_error", { zone: ZONE, reason: "no-ad" });
      return { shown: false, reason: "no-ad" };
    }
    track("vast_loaded", { zone: ZONE });

    /*
      🔴 THE RESOLVE BUDGET IS DONE; PLAYBACK GETS ITS OWN.

      These two waits are different promises and sharing one timer is what made
      this zone report exactly zero impressions. Before a creative exists the
      visitor may be waiting for nothing, so a short fail-open budget is right.
      Now that one is in hand they are going to see an ad, the overlay is about
      to be on screen, and abandoning it at 3s throws away both the seconds
      already spent AND the impression — while the measured cold start for a
      Hilltop creative is ~10.9s (scripts/vast-playback-probe.mjs).

      A fresh controller, because the old one's abort has already been armed
      against the resolve deadline and cannot be un-armed.
    */
    clearTimeout(budget);
    const playController = new AbortController();
    const playBudget = setTimeout(() => playController.abort(), config.startTimeoutMs);

    // The heavy half — React overlay + player — loads ONLY now, with a creative
    // already in hand. An empty zone never costs this bundle.
    const { showInterstitial } = await import("./overlay");
    phase = "playing";

    /*
      The per-moment skip delay. The overlay reads one field, so the override is
      applied to the config it is handed rather than to its signature — which
      also means every other guard in this function still sees the real config.
    */
    /*
      🔴 THE COMPLETION AD IS DISCOUNTED WHEN A GATE ALREADY PLAYED.

      A visitor who sat through a batch or top-quality gate to START this
      download has already paid once; charging them the full 15s again turns one
      download into ~45 seconds of advertising. `completeAfterRewardSeconds` is
      the discounted hold, and it applies ONLY to `download-complete` —
      `batch-complete` already has its own shorter number and is left alone.
    */
    const discounted =
      trigger === "download-complete" && Date.now() - rewardShownAt < REWARD_DISCOUNT_WINDOW_MS;
    const skipField = discounted
      ? ("completeAfterRewardSeconds" as SkipField)
      : SKIP_FIELD_BY_TRIGGER[trigger];
    const effectiveConfig = skipField
      ? { ...config, skipAfterSeconds: (await loadSkipSeconds(skipField)) ?? config.skipAfterSeconds }
      : config;

    const outcome = await showInterstitial({
      creative,
      config: effectiveConfig,
      startSignal: playController.signal,
      onStarted: () => clearTimeout(playBudget),
    });

    clearTimeout(playBudget);
    clearTimeout(budget);
    lastShownAt.set(trigger, Date.now());
    lastAnyShownAt = Date.now();
    /*
      Recorded only when the gate genuinely PLAYED. A gate that was refused,
      timed out or found no fill cost the visitor nothing, so it must not buy
      them a discount on the completion ad.
    */
    if (REWARD_TRIGGERS.has(trigger)) rewardShownAt = Date.now();
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
