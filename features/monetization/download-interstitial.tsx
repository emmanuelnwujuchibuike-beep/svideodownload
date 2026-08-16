"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { getCompletedCount, onDownloadCompleted } from "@/features/downloads/manager";
import { getWatchCount, isPlayerOpen, onVideoWatched } from "@/features/downloads/player-store";
import { upgradeCta, upgradeHeadline } from "@/lib/monetization/upgrade-cta";

import { FullscreenInterstitial } from "./fullscreen-interstitial";
import { useInterstitialConfig } from "./use-interstitial-skip";
import { useShowAds } from "./use-show-ads";

/**
 * The download-flow interstitial — the owner's triggers on the download and
 * library surfaces:
 *
 *   1. 5 s of in-page idle,
 *   2. every 3rd completed download,
 *   3. every 3rd video watched from the download history,
 *   4. a browser-back / back-swipe navigation.
 *
 * ── Who sees which ────────────────────────────────────────────────────────────
 * Idle, download and backswipe are ad monetisation, so they only fire for
 * visitors who see ads at all (free + signed-out). The WATCH trigger is the one
 * exception the owner called out: a Pro user still sees it (but never Business,
 * who is fully ad-free). Business sees nothing here.
 *
 * 🔴 BACKSWIPE, ADDED (owner, 2026-08-16: "trigger on every page back swipe or
 * browser back with the browser back button, you know static next 15 site is
 * hard for Google to trigger interstitial on page swipe and navigation").
 * This app already had exactly one `popstate`-driven ad trigger —
 * `monetag-placements.tsx`'s `hasBackswipe` block — but it only ever loads a
 * Monetag script; there was no AdSense-capable equivalent. `AdSlot`/`zone`
 * (via `FullscreenInterstitial` below) already knows how to render an
 * AdSense unit for a zone that has one configured, same as every other
 * trigger here, so this reuses that path rather than inventing a second ad
 * mechanism. `router.back()` (the PWA edge-swipe handler) and a literal
 * browser-back tap both fire a real `popstate` — one listener covers both.
 *
 * ── No double interstitials ───────────────────────────────────────────────────
 * It shares the site interstitial's cooldown key, so on a page that also carries
 * the marketing IdleInterstitial (the library) the two coordinate — whichever
 * fires first holds the 60 s window. Pass `triggers` to drop the idle trigger
 * there, since that page already has one.
 *
 * ── Preloads, like the site interstitial ──────────────────────────────────────
 * The slot is mounted hidden from the start so the creative fetches in the
 * background; when a trigger fires the overlay reveals with no wait. The X is a
 * solid, high-contrast control present from the first frame.
 */

const IDLE_MS = 5_000;
const COOLDOWN_MS = 60_000;
const MIN_GAP_MS = 3_000;
const EVERY = 3;
/**
 * History watches use their OWN interval (owner, 2026-08-04): the ad shows when
 * the SECOND video finishes, not the third. Kept separate from `EVERY` so
 * changing the download cadence never silently moves the watch cadence.
 */
const WATCH_EVERY = 2;
/** Shared with the marketing IdleInterstitial so they never both fire. */
const LAST_SHOWN_KEY = "frenz:interstitial-last-shown";
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export type InterstitialTrigger = "idle" | "download" | "watch" | "backswipe";

export function DownloadInterstitial({
  triggers = ["idle", "download", "watch", "backswipe"],
}: {
  triggers?: InterstitialTrigger[];
}) {
  const { showAds, ready } = useShowAds();
  const { plan } = useEntitlements();
  const { skipSeconds, historyVideo: historyVideoOn } = useInterstitialConfig();
  const [open, setOpen] = useState(false);
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState(0);
  const mountedAt = useRef(Date.now());

  // Business never sees an interstitial. Free/guest see all triggers; Pro sees
  // only the watch trigger (the owner's explicit exception).
  const watchAllowed = plan !== "business";
  const canPreload = ready && (showAds || (plan === "pro" && triggers.includes("watch")));

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    if (open) return;
    if (Date.now() - mountedAt.current < MIN_GAP_MS) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(LAST_SHOWN_KEY)) || 0;
    } catch {
      last = Date.now(); // storage blocked → fail closed on the cooldown
    }
    if (Date.now() - last < COOLDOWN_MS) return;
    try {
      sessionStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* in-memory `open` still prevents a double-fire this tick */
    }
    setOpen(true);
  }, [open]);

  // Idle + download triggers — ad visitors only (free / signed-out).
  useEffect(() => {
    if (!ready || !showAds) return;
    const offs: (() => void)[] = [];

    if (triggers.includes("idle")) {
      let timer: number | undefined;
      // Never over a clip the visitor is actively watching (owner: the interstitial
      // "shouldn't [show] while video is playing"). The review player being open is
      // the signal — the idle timer would otherwise run down while a video plays
      // (watching isn't "activity") and pop the ad over it.
      const arm = () => {
        window.clearTimeout(timer);
        if (document.visibilityState === "visible") timer = window.setTimeout(() => { if (!isPlayerOpen()) show(); }, IDLE_MS);
      };
      for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true });
      arm();
      offs.push(() => {
        window.clearTimeout(timer);
        for (const e of ACTIVITY) window.removeEventListener(e, arm);
      });
    }

    if (triggers.includes("download")) {
      offs.push(onDownloadCompleted(() => {
        if (isPlayerOpen()) return; // never interrupt a clip mid-watch
        if (getCompletedCount() % EVERY === 0) show();
      }));
    }

    if (triggers.includes("backswipe")) {
      // Covers BOTH a literal browser-back tap AND the PWA edge-swipe gesture
      // (features/app-shell/edge-swipe-back.tsx calls `router.back()`, which
      // fires a real `popstate` same as the browser control does) — one
      // listener, two gestures. `show()` already applies its own cooldown/
      // min-gap, so a flurry of back taps still only ever shows one ad.
      const onPop = () => {
        if (isPlayerOpen()) return; // never interrupt a clip mid-watch
        show();
      };
      window.addEventListener("popstate", onPop);
      offs.push(() => window.removeEventListener("popstate", onPop));
    }

    return () => offs.forEach((off) => off());
  }, [ready, showAds, triggers, show]);

  // Watch trigger — free/guest AND Pro (not Business), and only when the admin
  // has switched it on. `onVideoWatched` fires on a NATURAL end only, so this
  // can never interrupt a clip mid-watch: the ad lands as the 2nd video
  // finishes, which is exactly the moment the owner asked for.
  useEffect(() => {
    if (!ready || !watchAllowed || !historyVideoOn || !triggers.includes("watch")) return;
    return onVideoWatched(() => {
      if (getWatchCount() % WATCH_EVERY === 0) show();
    });
  }, [ready, watchAllowed, historyVideoOn, triggers, show]);

  const shown = open && hasAd === true;
  // The admin-set skip delay: while it counts down the ad can't be dismissed;
  // at 0 (immediately, if the admin chose 0) it becomes skippable.
  const canSkip = remaining <= 0;

  // Start the skip countdown when the ad becomes visible.
  useEffect(() => {
    if (!shown) return;
    setRemaining(skipSeconds);
    if (skipSeconds <= 0) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [shown, skipSeconds]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canSkip) close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [shown, canSkip, close]);

  if (!canPreload) return null;

  // The upsell follows the plan through the SHARED helper, so this can never
  // drift back into offering a Pro customer another Pro subscription.
  const offer = upgradeCta(plan);
  const upsell = offer ? { text: upgradeHeadline(plan), cta: offer.label, href: offer.href } : undefined;

  return (
    <FullscreenInterstitial
      zone="idle_interstitial"
      shown={shown}
      onClose={close}
      onResolved={setHasAd}
      canSkip={canSkip}
      remaining={remaining}
      upsell={upsell}
    />
  );
}
