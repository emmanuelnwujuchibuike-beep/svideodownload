"use client";

import { track } from "@/lib/analytics/client";
import type { VastCreative } from "@/lib/monetization/vast";
import {
  effectiveSkipSeconds,
  skipRemainingSeconds,
  type VastInterstitialConfig,
} from "@/lib/monetization/vast-interstitial";

/**
 * The full-screen VAST stage.
 *
 * ── Plain DOM, deliberately, not React ────────────────────────────────────────
 *
 * It is invoked imperatively from a promise inside a click handler, so there is
 * no component tree to hang it from without inventing global state to bridge
 * them. Building it as DOM avoids that bridge entirely and, more importantly,
 * avoids the failure this feature already hit twice: a React parent that gates
 * visibility on the player's own callback puts the video in a `display:none`
 * subtree, where it measures 0x0, never plays, and never reports back. Nothing
 * here can re-render it out from under itself.
 *
 * It also means the lazy chunk is a few KB of DOM code rather than a component
 * plus its render dependencies.
 *
 * ── Every exit path is the same exit path ─────────────────────────────────────
 *
 * `finish()` is idempotent and is the only way out — skip, complete, error,
 * Escape, timeout and unmount all route through it, so the overlay, the video,
 * the listeners and the body lock cannot survive any of them.
 */

export type Outcome = "completed" | "skipped" | "error";

/** Fire a tracking pixel. Image, not fetch: no CORS, no preflight, non-blocking. */
function pixel(urls: string[] | undefined) {
  for (const url of urls ?? []) {
    try {
      const img = new Image();
      img.referrerPolicy = "no-referrer-when-downgrade";
      img.src = url;
    } catch {
      /* Tracking must never break playback. */
    }
  }
}

export function showInterstitial({
  creative,
  config,
  startSignal,
  onStarted,
}: {
  creative: VastCreative;
  config: VastInterstitialConfig;
  /** Aborts if the startup budget expires before the first frame plays. */
  startSignal: AbortSignal;
  onStarted: () => void;
}): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    if (typeof document === "undefined") {
      resolve("error");
      return;
    }

    const fired = new Set<string>();
    let settled = false;
    let started = false;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;

    // ── Stage ────────────────────────────────────────────────────────────────
    const root = document.createElement("div");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Advertisement");
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483000",
      "background:#000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      // 100dvh so mobile browser chrome cannot crop the stage.
      "height:100dvh",
      "width:100vw",
      /*
        ═══════════════════════════════════════════════════════════════════
         🔴 MOUNTED INVISIBLE, REVEALED ON `playing`
        ═══════════════════════════════════════════════════════════════════

        Owner, 2026-09-02: "when vast triggers it shows blank for 5 secs
        before playing the video."

        Correct, and it is the cost of the budget split that fixed the
        zero-impression bug. Playback now gets up to 12s to start instead of
        being killed at 3s — which is what lets the impression fire at all —
        but the overlay used to appear the instant it was built, so that
        extra patience was spent showing the visitor a black rectangle.

        So the stage is built, laid out and loading from the first frame, and
        only made VISIBLE once the video actually reports `playing`. The
        member sees the app until there is a real ad to show, then the ad.
        Nobody watches a blank.

        ⛔ `opacity`, NEVER `display:none`. A `display:none` <video> is not
        laid out and browsers do not load it — a standing law in this
        codebase — so hiding it that way would guarantee the ad never starts
        and put the impression back at zero. `visibility:hidden` has the same
        risk on some engines. Opacity keeps the element live and decoding.

        `pointer-events:none` while invisible so an unrevealed overlay can
        never swallow a tap meant for the page underneath it.
      */
      "opacity:0",
      "pointer-events:none",
      "transition:opacity 180ms ease-out",
    ].join(";");

    const video = document.createElement("video");
    video.src = creative.mediaUrl;
    // Muted is not a preference — it is the only autoplay browsers permit.
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.style.cssText = "max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain";

    const chrome = document.createElement("div");
    chrome.style.cssText = [
      "position:absolute",
      "top:calc(env(safe-area-inset-top,0px) + 12px)",
      "right:calc(env(safe-area-inset-right,0px) + 12px)",
      "left:calc(env(safe-area-inset-left,0px) + 12px)",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
      "pointer-events:none",
    ].join(";");

    const badge = document.createElement("span");
    badge.textContent = "Ad";
    badge.style.cssText =
      "background:rgba(0,0,0,.55);color:#fff;font:600 11px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:6px 8px;border-radius:6px;backdrop-filter:blur(4px)";

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.disabled = true;
    skipBtn.style.cssText =
      "pointer-events:auto;background:rgba(0,0,0,.6);color:#fff;font:600 13px/1 system-ui,sans-serif;padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.25);backdrop-filter:blur(6px);cursor:default";

    const mute = document.createElement("button");
    mute.type = "button";
    mute.setAttribute("aria-label", "Unmute ad");
    mute.textContent = "🔇";
    mute.style.cssText = [
      "position:absolute",
      "bottom:calc(env(safe-area-inset-bottom,0px) + 16px)",
      "right:calc(env(safe-area-inset-right,0px) + 16px)",
      "background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:999px",
      "width:44px;height:44px;font-size:18px;cursor:pointer;backdrop-filter:blur(6px)",
    ].join(";");

    /*
      🔴 The skip control obeys the VAST response, not just the admin setting.

      `skippable` on the creative reflects what the ad allows. When the response
      says the ad may not be skipped, no control is shown at all — a button that
      claims to skip and does not is the deceptive pattern the brief forbids, and
      firing `complete` on a skip would be inventing a completion that never
      happened.
    */
    const maySkip = config.skipEnabled;

    /*
      The admin number is a CEILING, capped by the ad's own length — see
      `effectiveSkipSeconds`. Seeded from the VAST `<Duration>` so the very
      first paint already shows the right number, then re-derived on
      `loadedmetadata` once the real file's length is known.
    */
    let skipAt = effectiveSkipSeconds({
      configuredSeconds: config.skipAfterSeconds,
      vastDurationSeconds: creative.durationSeconds,
    });
    let startedAtMs = 0;
    let remaining = skipAt;

    const paintSkip = () => {
      if (remaining > 0) {
        skipBtn.textContent = `Skip in ${remaining}`;
        skipBtn.disabled = true;
        skipBtn.style.cursor = "default";
        skipBtn.style.opacity = "0.75";
      } else {
        skipBtn.textContent = "Skip →";
        skipBtn.disabled = false;
        skipBtn.style.cursor = "pointer";
        skipBtn.style.opacity = "1";
      }
    };

    // ── The single exit ──────────────────────────────────────────────────────
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      if (countdownTimer) clearInterval(countdownTimer);
      try {
        video.pause();
        // Release the media so the file stops downloading the moment we are done.
        video.removeAttribute("src");
        video.load();
      } catch {
        /* teardown must never throw */
      }
      document.removeEventListener("keydown", onKey);
      startSignal.removeEventListener("abort", onAbort);
      root.remove();
      document.documentElement.style.overflow = prevOverflow;
      /*
        🔴 ONLY GIVE FOCUS BACK IF WE EVER TOOK IT. An overlay that was never
        revealed never moved focus, and yanking it to whatever happened to be
        active when the ad was requested would interrupt someone who has been
        using the page normally for the whole (invisible) attempt.
      */
      if (started) previouslyFocused?.focus?.();
      resolve(outcome);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape only works once skipping is genuinely permitted — otherwise it
      // would be a hidden bypass of the rule the visible control obeys.
      if (maySkip && remaining <= 0) doSkip();
    };
    const onAbort = () => finish("error");
    const doSkip = () => {
      if (!maySkip || remaining > 0) return;
      // A skip is NOT a completion: fire the VAST skip pixel if the response
      // carried one, and never `complete`.
      pixel(creative.tracking.skip);
      track("vast_skipped", { at: Math.round(video.currentTime) });
      finish("skipped");
    };

    skipBtn.addEventListener("click", doSkip);
    mute.addEventListener("click", () => {
      video.muted = !video.muted;
      mute.textContent = video.muted ? "🔇" : "🔊";
      mute.setAttribute("aria-label", video.muted ? "Unmute ad" : "Mute ad");
      if (!video.muted) void video.play().catch(() => {});
    });

    /**
     * Show the stage. Idempotent, and the ONLY thing that makes this overlay
     * visible, lock the page or take focus — see the note at the mount.
     */
    const reveal = () => {
      root.style.opacity = "1";
      root.style.pointerEvents = "auto";
      document.documentElement.style.overflow = "hidden";
      skipBtn.focus?.();
    };

    video.addEventListener("playing", () => {
      if (started) return;
      started = true;
      /*
        🔴 REVEAL FIRST, THEN COUNT THE IMPRESSION. The pixel means "a human
        saw a frame of this ad", so it must not go out before the frame is on
        screen. One statement apart, and in this order for that reason.
      */
      reveal();
      onStarted();
      pixel(creative.impressions);
      pixel(creative.tracking.start);
      track("vast_started", {});
      if (maySkip) {
        startedAtMs = Date.now();
        paintSkip();
        /*
          Recomputed from playback position each tick rather than decremented.
          A decrementing counter cannot react to what this timer now has to
          react to: a `loadedmetadata` that shortens `skipAt`, and a stall that
          should stop the countdown advancing. `skipRemainingSeconds` owns both
          rules (and its wall-clock floor is what stops a dead stream trapping
          the visitor behind a skip that never unlocks).
        */
        countdownTimer = setInterval(() => {
          remaining = skipRemainingSeconds({
            skipAtSeconds: skipAt,
            playedSeconds: video.currentTime,
            elapsedSeconds: (Date.now() - startedAtMs) / 1000,
          });
          paintSkip();
          if (remaining === 0 && countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
          }
        }, 250);
      }
    });

    /*
      The real file's length, which outranks the VAST's claim about it. An
      ExoClick or Ad Manager response that declares 30s and delivers a 6s file
      would otherwise hold the skip control 24 seconds past the end of the ad.
    */
    video.addEventListener("loadedmetadata", () => {
      skipAt = effectiveSkipSeconds({
        configuredSeconds: config.skipAfterSeconds,
        vastDurationSeconds: creative.durationSeconds,
        mediaDurationSeconds: video.duration,
      });
      if (!started) remaining = skipAt;
      if (maySkip) paintSkip();
    });

    video.addEventListener("timeupdate", () => {
      // The view beacon — driven by real playback position, fired once each.
      for (const p of creative.progress) {
        const key = `p${p.offsetSeconds}`;
        if (video.currentTime >= p.offsetSeconds && !fired.has(key)) {
          fired.add(key);
          pixel([p.url]);
        }
      }
      const total = creative.durationSeconds || video.duration;
      if (!total || !Number.isFinite(total)) return;
      for (const [at, ev] of [
        [0.25, "firstQuartile"],
        [0.5, "midpoint"],
        [0.75, "thirdQuartile"],
      ] as const) {
        if (video.currentTime >= total * at && !fired.has(ev)) {
          fired.add(ev);
          pixel(creative.tracking[ev]);
        }
      }
    });

    video.addEventListener("ended", () => {
      pixel(creative.tracking.complete);
      track("vast_completed", {});
      finish("completed");
    });
    /*
      ═══════════════════════════════════════════════════════════════════════
       🔴 A DEAD CODEC MUST NOT COST THE IMPRESSION
      ═══════════════════════════════════════════════════════════════════════

      The impression and `start` pixels fire from `playing`, which is correct —
      a pixel sent before the first frame is a lie the network can charge back.
      The consequence is that a rendition this device cannot DECODE loses the
      whole ad silently: no impression, no start, no error the network sees,
      and a dashboard reading exactly zero.

      That was not hypothetical. HilltopAds ships webm/mp4/flv of every creative
      at identical dimensions, `pickMedia` was picking by height alone, and with
      all three the same height the first in document order won — the WebM.
      Every WebKit browser (so every iOS browser) refuses it. `pickMedia` now
      ranks MP4 first, and this is the second line of defence: whatever the
      server chose, if the element cannot play it, walk the remaining
      renditions before giving up.

      Only ONE `error` pixel is ever sent, on the last rendition, because the
      ad has only failed once no rendition is left.
    */
    let nextMedia = 0;
    video.addEventListener("error", () => {
      const fallback = creative.fallbacks?.[nextMedia];
      if (fallback && !started) {
        nextMedia++;
        track("vast_media_fallback", { to: fallback.type, index: nextMedia });
        video.src = fallback.url;
        video.load();
        void video.play().catch(() => {});
        return;
      }
      pixel(creative.tracking.error);
      track("vast_error", { reason: "media" });
      finish("error");
    });

    if (creative.clickThrough) {
      const click = document.createElement("button");
      click.type = "button";
      click.setAttribute("aria-label", "Visit advertiser");
      click.style.cssText = "position:absolute;inset:0;background:transparent;border:0;cursor:pointer";
      click.addEventListener("click", () => {
        pixel(creative.clickTracking);
        window.open(creative.clickThrough!, "_blank", "noopener,noreferrer");
      });
      root.appendChild(video);
      root.appendChild(click);
    } else {
      root.appendChild(video);
    }

    chrome.appendChild(badge);
    if (maySkip) chrome.appendChild(skipBtn);
    root.appendChild(chrome);
    root.appendChild(mute);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.documentElement.style.overflow;
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey);
    startSignal.addEventListener("abort", onAbort);
    if (maySkip) paintSkip();

    /*
      🔴 THE SCROLL LOCK AND THE FOCUS MOVE WAIT FOR THE REVEAL TOO.

      Both are things the visitor can FEEL. Locking the page the moment an
      invisible overlay mounts would freeze scrolling for up to 12 seconds
      while nothing is on screen — a worse bug than the blank it replaced —
      and stealing focus to a skip button nobody can see would strand a
      keyboard or screen-reader user in a dialog that is not there yet.

      Both are applied by `reveal()`, which runs from the `playing` handler.
    */

    /*
      Autoplay can still be refused. That is not an error the visitor should pay
      for — the startup budget in `request.ts` is already running, and when it
      expires `onAbort` tears this down and the download proceeds.
    */
    void video.play().catch(() => {
      track("vast_error", { reason: "autoplay-blocked" });
    });
  });
}
