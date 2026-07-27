"use client";

import { Crown, X } from "lucide-react";
import Link from "next/link";

import type { AdZone } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";

/**
 * Full-screen interstitial shell (owner: "make the interstitial display full
 * screen like this screenshot"). Instead of a small centered card, the creative
 * sits on a solid full-screen backdrop with a single high-contrast Close control
 * in the top-right — the app-interstitial look every network (Adsterra, Monetag,
 * AdSense vignette) ships. Shared by the download / idle / exit-intent triggers
 * so they're identical.
 *
 * The close control clears the status bar / Dynamic Island via --frenz-safe-top.
 * While a skip delay counts down it shows "Skip in Ns" and the ad can't be
 * dismissed; at 0 it becomes a real X (and the backdrop dismisses too). An
 * optional, deliberately-subtle upsell pill sits at the bottom so the upgrade
 * path survives without competing with the ad.
 */
export function FullscreenInterstitial({
  zone,
  shown,
  onClose,
  onResolved,
  canSkip = true,
  remaining = 0,
  upsell,
}: {
  zone: AdZone;
  /** Open AND the slot has confirmed a creative. */
  shown: boolean;
  onClose: () => void;
  onResolved: (hasAd: boolean) => void;
  /** False while a skip countdown runs — hides the X and blocks backdrop dismiss. */
  canSkip?: boolean;
  remaining?: number;
  upsell?: { text: string; cta: string; href: string };
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] bg-black transition-opacity duration-200",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!shown}
      role="dialog"
      aria-modal={shown}
      aria-label="Advertisement"
    >
      {/* Backdrop — dismisses only once skippable. */}
      <button
        type="button"
        aria-label="Close advertisement"
        tabIndex={shown && canSkip ? 0 : -1}
        onClick={() => canSkip && onClose()}
        className={cn("absolute inset-0 h-full w-full", canSkip ? "cursor-pointer" : "cursor-not-allowed", !shown && "hidden")}
      />

      {/* The creative — centered on full-screen black, as large as it declares. */}
      <div
        className={cn("pointer-events-none absolute inset-0 flex items-center justify-center px-3", !shown && "hidden")}
        style={{
          paddingTop: "calc(var(--frenz-safe-top) + 4rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 3.5rem)",
        }}
      >
        {/* pointer-events re-enabled on the ad itself so the backdrop stays clickable around it. */}
        <AdSlot zone={zone} dismissible={false} onResolved={onResolved} className="pointer-events-auto flex w-full max-w-md items-center justify-center" />
      </div>

      {/* Skip / close — top-right, clear of the status bar / Dynamic Island. */}
      <div className="absolute right-4 z-20" style={{ top: "calc(0.75rem + var(--frenz-safe-top))" }}>
        {canSkip ? (
          <button
            type="button"
            onClick={onClose}
            tabIndex={shown ? 0 : -1}
            aria-label="Close advertisement"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              !shown && "hidden",
            )}
          >
            <X className="h-6 w-6" strokeWidth={2.5} />
          </button>
        ) : (
          <span
            aria-live="polite"
            className={cn("inline-flex h-11 items-center rounded-full bg-white/15 px-4 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur-md", !shown && "hidden")}
          >
            Skip in {remaining}s
          </span>
        )}
      </div>

      {upsell ? (
        <Link
          href={upsell.href}
          onClick={onClose}
          tabIndex={shown ? 0 : -1}
          className={cn(
            "absolute inset-x-0 z-20 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/20 hover:text-white",
            !shown && "hidden",
          )}
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <Crown className="h-3.5 w-3.5" /> {upsell.text}
          <span className="font-semibold underline decoration-white/40 underline-offset-2">{upsell.cta}</span>
        </Link>
      ) : null}
    </div>
  );
}
