"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { useCloseViaDirectLink } from "@/features/monetization/use-direct-link";
import { adCloseSpot } from "@/lib/monetization/direct-link";
import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
import { DEFAULT_VAST_INTERSTITIAL, normalizeVastInterstitial } from "@/lib/monetization/vast-interstitial";
import { cn } from "@/lib/utils";

import { trackAdEvent, type AdView } from "../ad-events-client";

/** How far a finger must travel for a swipe to move on (the History viewer's ad). */
const SWIPE_PX = 50;

// loaded only when a full-screen ad opens — a page that never shows one never fetches it
const FullscreenAd = dynamic(() => import("./fullscreen-video-ad").then((m) => m.FullscreenAd), { ssr: false });

/**
 * A full-screen paid ad — INTERSTITIAL, DOWNLOAD_COMPLETED_INTERSTITIAL, and
 * the sponsor video beside an AI save (REWARD_VIDEO).
 *
 * Never a trap (§37/§38), with one owner-set exception:
 *   · 🔴 2026-10-10 (owner: "make interstitial ad to be skipped after 5 seconds
 *     or any set by admin, 5 secs as default"): close, Escape, a backdrop tap
 *     wait out a short countdown — the admin's "Seconds before an
 *     ad can be skipped" (Monetization → VAST interstitial, 0–30 s, default 5),
 *     so every interstitial follows one setting. It is shown and announced. A
 *     REWARD video has no countdown — it never gates anything (below). A
 *     creative that FAILS still closes at once — nobody waits on a broken ad
 *   · focus moves to the close button and goes back where it was
 *   · the page under it does not scroll while it is open
 *   · the video is muted, pauses and is released on close (SelfAdCreative)
 *   · a creative that fails closes the sheet at once — it never shows broken
 *
 * `reward` changes the words and the events only. It NEVER gates anything:
 * the save it accompanies has already started, and "Continue" is enabled from
 * the first frame. `reward_video_complete` is sent only when the video really
 * ended — never on close or skip.
 */
export function SelfInterstitial({
  ad,
  placement,
  page,
  reward = false,
  rewardText,
  onRewardComplete,
  slot,
  swipeNext = false,
  onClose,
}: {
  /**
   * The History viewer's ad (owner, 2026-10-15: "users should be able to next it by swiping
   * or tapping at the left or right but during the count down nothing swipe or next should
   * work"). Once the countdown ends, a tap on either side or a swipe (left, right or up)
   * moves on to the next media, as the media itself does. Before that, neither does
   * anything. The middle stays the ad's own (pause, details).
   */
  swipeNext?: boolean;
  /** the canonical moment slot it occupies (lib/ads-platform/slot-registry.ts) */
  slot?: string;
  ad: EligibleAd;
  placement: string;
  page: string;
  reward?: boolean;
  /** 0203: a download reward gate's own line, in place of the AI save's */
  rewardText?: string;
  /** 0203: the reward video was watched to the end */
  onRewardComplete?: () => void;
  onClose: () => void;
}) {
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const view = useRef<AdView | null>(null);
  const [ended, setEnded] = useState(false);
  // seconds until it may be skipped: the default at once, the admin's value when the (cached) config answers
  // a REWARD video is never gated (it accompanies a save that has already started) — no countdown for it
  const [left, setLeft] = useState<number>(reward ? 0 : DEFAULT_VAST_INTERSTITIAL.skipAfterSeconds);
  const canSkip = left <= 0;
  const canSkipRef = useRef(canSkip);
  canSkipRef.current = canSkip;
  const dialog = useRef<HTMLDivElement | null>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (reward) return;
    let alive = true;
    const opened = Date.now();
    void loadAdsConfig()
      .then((d) => {
        const c = d as { vastInterstitial?: unknown; interstitialSkipSeconds?: unknown };
        // the one admin setting for every full-screen ad ("Interstitial skip delay"), else the VAST value
        return typeof c.interstitialSkipSeconds === "number" ? c.interstitialSkipSeconds : normalizeVastInterstitial(c.vastInterstitial).skipAfterSeconds;
      })
      .catch(() => DEFAULT_VAST_INTERSTITIAL.skipAfterSeconds)
      .then((secs) => {
        if (alive) setLeft(Math.max(0, Math.ceil(secs - (Date.now() - opened) / 1000)));
      });
    return () => {
      alive = false;
    };
  }, [reward]);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  useEffect(() => {
    if (canSkip) closeBtn.current?.focus();
  }, [canSkip]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // the dialog takes focus first; the close button gets it once it can be used
    dialog.current?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canSkipRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
      before?.focus?.();
    };
  }, [onClose]);

  /*
    🔴 THE X OPENS THE MONETAG DIRECT LINK, THEN CLOSES (owner, 2026-10-23: "the X button to close that should open
    the Monetag direct link still doesn't work"). A paid campaign takes the Download complete moment from the
    network panel (momentClaimed), and this full-screen ad's X only closed — the link was wired on the network
    panel alone. Same "Ad close button" spot and the same admin switch; no link set up → it just closes.
  */
  const closeViaLink = useCloseViaDirectLink(adCloseSpot(reward), onClose);

  if (typeof document === "undefined") return null;

  // History viewer: a swipe moves on, but only once the ad may be skipped
  const onPointerDown = (e: ReactPointerEvent) => {
    swipeFrom.current = swipeNext && canSkipRef.current ? { x: e.clientX, y: e.clientY } : null;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (!from || !canSkipRef.current) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) >= SWIPE_PX || dy <= -SWIPE_PX) onClose();
  };

  // the one place a reward completes — only on the video's real end, never on close or skip
  const handleEnded = () => {
    if (reward && view.current) trackAdEvent(view.current, "reward_video_complete");
    if (reward) onRewardComplete?.();
    setEnded(true);
  };

  // the skip countdown, then the close button — the same control in both layouts
  const skipControl = (dark: boolean) =>
    canSkip ? (
      <button
        ref={closeBtn}
        type="button"
        onClick={closeViaLink}
        data-ad-spot={adCloseSpot(reward)}
        aria-label={reward ? "Close the sponsored video" : "Close the ad"}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
          dark ? "bg-black/45 text-white backdrop-blur-md ring-1 ring-inset ring-white/20 hover:bg-black/60" : "bg-muted text-foreground hover:bg-muted/70",
        )}
      >
        <X className="h-[18px] w-[18px]" aria-hidden />
      </button>
    ) : (
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex h-9 items-center rounded-full px-3 text-[12px] font-semibold tabular-nums",
          dark ? "bg-black/45 text-white/90 backdrop-blur-md ring-1 ring-inset ring-white/20" : "bg-muted text-muted-foreground",
        )}
      >
        Skip in {left}
      </span>
    );

  /*
    🔴 FULL SCREEN, image or video (owner, 2026-10-14: "full screen ad like Snapchat and TikTok on
    download complete, batch and HD — image too should be full screen, except the one on a card").
    The same dialog — skip countdown, Escape, focus and scroll lock above — around the shared
    full-screen layout. The half-height sheet images used to get is gone.
  */
  return createPortal(
    <div
      className="fixed inset-0 z-[96] bg-black animate-in fade-in duration-200 motion-reduce:animate-none"
      role="dialog"
      aria-modal="true"
      data-paid-ad=""
      data-ad-slot={slot}
      data-ad-provider="frenzsave"
      aria-label={reward ? `Sponsored video from ${ad.sponsor}` : `Advertisement from ${ad.sponsor}`}
      ref={dialog}
      tabIndex={-1}
      onPointerDown={swipeNext ? onPointerDown : undefined}
      onPointerUp={swipeNext ? onPointerUp : undefined}
      onPointerCancel={swipeNext ? () => (swipeFrom.current = null) : undefined}
      style={swipeNext ? { touchAction: "none" } : undefined}
    >
      <FullscreenAd
        ad={ad}
        placement={placement}
        page={page}
        loop={!reward}
        topRight={skipControl(true)}
        note={
          reward
            ? rewardText
              ? ended
                ? "Unlocked. Thanks for watching."
                : rewardText
              : `Your video is saving. ${ended ? "Thanks for watching." : "A short message from our sponsor while it does."}`
            : undefined
        }
        footer={
          reward ? (
            <button
              type="button"
              onClick={onClose}
              className="mt-2.5 flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-white/15 text-[14px] font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-md transition active:scale-[0.98] motion-reduce:active:scale-100"
            >
              Continue
            </button>
          ) : null
        }
        onView={(v) => {
          view.current = v;
          trackAdEvent(v, reward ? "reward_video_start" : "interstitial_view");
        }}
        onEnded={handleEnded}
        onFail={onClose}
      >
        {/* History viewer: the two sides move on, as they do on the media — only after the countdown */}
        {swipeNext && canSkip ? (
          <>
            <button type="button" aria-label="Next" onClick={onClose} data-ad-next="left" className="absolute inset-y-0 left-0 w-[30%]" />
            <button type="button" aria-label="Next" onClick={onClose} data-ad-next="right" className="absolute inset-y-0 right-0 w-[30%]" />
          </>
        ) : null}
      </FullscreenAd>
    </div>,
    document.body,
  );
}
