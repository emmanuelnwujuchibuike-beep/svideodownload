"use client";

import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { cn } from "@/lib/utils";

import { trackAdEvent, type AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { destinationHost, SelfAdCreative } from "./self-ad-creative";

/**
 * A full-screen paid ad — INTERSTITIAL, DOWNLOAD_COMPLETED_INTERSTITIAL, and
 * the sponsor video beside an AI save (REWARD_VIDEO).
 *
 * Never a trap (§37/§38):
 *   · the close button is there from the first frame, Escape closes, a tap on
 *     the backdrop closes — no countdown gates leaving
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
  onClose,
}: {
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
  const host = destinationHost(ad.url);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
      before?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[96] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none sm:items-center"
      role="dialog"
      aria-modal="true"
      data-paid-ad=""
      data-ad-slot={slot}
      data-ad-provider="frenzsave"
      aria-label={reward ? `Sponsored video from ${ad.sponsor}` : `Advertisement from ${ad.sponsor}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "relative w-full max-w-md overflow-hidden rounded-t-[1.75rem] bg-card shadow-elevated sm:rounded-[1.75rem]",
          "pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom-6 duration-300 motion-reduce:animate-none sm:pb-0",
        )}
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Ad</span>
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{ad.sponsor}</p>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            aria-label={reward ? "Close the sponsored video" : "Close the ad"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        {reward ? (
          <p className="px-4 pb-2 text-[13px] leading-snug text-muted-foreground">
            {rewardText ? (ended ? "Unlocked. Thanks for watching." : rewardText) : <>Your video is saving. {ended ? "Thanks for watching." : "A short message from our sponsor while it does."}</>}
          </p>
        ) : null}

        <SelfAdCreative
          ad={ad}
          placement={placement}
          page={page}
          fit="contain"
          loop={!reward}
          eager
          className="aspect-[4/5] max-h-[62dvh] w-full bg-black"
          onView={(v) => {
            view.current = v;
            trackAdEvent(v, reward ? "reward_video_start" : "interstitial_view");
          }}
          onEnded={() => {
            if (reward && view.current) trackAdEvent(view.current, "reward_video_complete");
            if (reward) onRewardComplete?.();
            setEnded(true);
          }}
          onFail={onClose}
        />

        <div className="space-y-2 px-4 pb-4 pt-3">
          {ad.headline ? <p className="text-[15px] font-semibold leading-snug">{ad.headline}</p> : null}
          {ad.body ? <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{ad.body}</p> : null}
          <div className="flex gap-2 pt-1">
            <a
              href={ad.url}
              target="_blank"
              rel="sponsored noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openAdDetail(ad, view.current);
              }}
              className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-[14px] font-semibold text-white transition active:scale-[0.98] motion-reduce:active:scale-100"
            >
              {host ? `Visit ${host}` : "Learn more"} <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
            {reward ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full bg-muted px-4 text-[14px] font-semibold"
              >
                Continue
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
