"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { getCompletedCount, onDownloadCompleted } from "@/features/downloads/manager";
import { getWatchCount, isPlayerOpen, onVideoWatched } from "@/features/downloads/player-store";

import { FullscreenInterstitial } from "./fullscreen-interstitial";
import { useInterstitialSkipSeconds } from "./use-interstitial-skip";
import { useShowAds } from "./use-show-ads";

/**
 * The download-flow interstitial — the owner's three triggers on the download and
 * library surfaces:
 *
 *   1. 5 s of in-page idle,
 *   2. every 3rd completed download,
 *   3. every 3rd video watched from the download history.
 *
 * ── Who sees which ────────────────────────────────────────────────────────────
 * Idle and the download trigger are ad monetisation, so they only fire for
 * visitors who see ads at all (free + signed-out). The WATCH trigger is the one
 * exception the owner called out: a Pro user still sees it (but never Business,
 * who is fully ad-free). Business sees nothing here.
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
/** Shared with the marketing IdleInterstitial so they never both fire. */
const LAST_SHOWN_KEY = "frenz:interstitial-last-shown";
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export type InterstitialTrigger = "idle" | "download" | "watch";

export function DownloadInterstitial({
  triggers = ["idle", "download", "watch"],
}: {
  triggers?: InterstitialTrigger[];
}) {
  const { showAds, ready } = useShowAds();
  const { plan } = useEntitlements();
  const skipSeconds = useInterstitialSkipSeconds();
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

    return () => offs.forEach((off) => off());
  }, [ready, showAds, triggers, show]);

  // Watch trigger — free/guest AND Pro (not Business).
  useEffect(() => {
    if (!ready || !watchAllowed || !triggers.includes("watch")) return;
    return onVideoWatched(() => {
      if (getWatchCount() % EVERY === 0) show();
    });
  }, [ready, watchAllowed, triggers, show]);

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

  // The upsell line follows the plan: free/guest are asked to go Pro, a Pro user
  // is only ever asked to go Business (never "upgrade to Pro").
  const upsell =
    plan === "pro"
      ? { text: "Want an ad-free library?", cta: "Go Business", href: "/pricing" }
      : { text: "Tired of ads?", cta: "Upgrade to Pro", href: "/pricing" };

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
