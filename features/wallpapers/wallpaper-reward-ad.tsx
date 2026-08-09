"use client";

import { Crown, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AdSlot } from "@/features/monetization/ad-slot";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { cn } from "@/lib/utils";
import { wallpaperLimitMessage } from "@/lib/wallpapers-limits";

/**
 * The 30-second ad shown to a free member while their wallpaper downloads.
 *
 * ── It runs ALONGSIDE the download, never in front of it ──────────────────────
 * The transfer has already started by the time this mounts (see
 * `useWallpaperDownload`). That matters for two reasons: the owner asked for the
 * download to begin immediately, and an ad that holds a file hostage is a
 * different, worse product than an ad that plays while you wait.
 *
 * It also means the honest label is "your download is running", which is what
 * the card says — not a promise of a reward in exchange for watching, which
 * would be a claim about a thing that already happened.
 *
 * ── Why the timer cannot be skipped ───────────────────────────────────────────
 * Thirty seconds, no skip button, because the advertiser is paying for thirty
 * seconds. The close button appears when the count reaches zero. There is no
 * hidden dismiss: tapping the backdrop does nothing while it runs, since a
 * backdrop that closes an ad is just a skip button nobody documented.
 *
 * ── Nobody is shown this twice for one download ───────────────────────────────
 * It mounts per download, and the five-a-day cap is what keeps the number of
 * these a person can see in a session inside what ad networks consider
 * reasonable. That cap is the whole reason it exists.
 */
export function WallpaperRewardAd({
  seconds,
  wallpaperName,
  remaining,
  onClose,
}: {
  seconds: number;
  wallpaperName: string;
  /** Free downloads left today, after this one. Null when uncapped. */
  remaining: number | null;
  onClose: () => void;
}) {
  const { showAds, ready } = useShowAds();
  const [left, setLeft] = useState(seconds);
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [left]);

  // A paying member is never shown this, and neither is anyone whose ad slot is
  // empty — an unfilled placeholder is 30 seconds of nothing.
  useEffect(() => {
    if (ready && !showAds) onClose();
  }, [ready, showAds, onClose]);
  useEffect(() => {
    if (hasAd === false) onClose();
  }, [hasAd, onClose]);

  if (!ready || !showAds) return null;
  const done = left <= 0;

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-neutral-950/97 backdrop-blur-sm">
      <div
        className="flex items-center justify-between gap-3 px-4 pb-3"
        style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 1rem)" }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">Downloading {wallpaperName}</p>
          <p className="mt-0.5 text-xs text-white/60">
            {/* Present tense on purpose: it is already happening. */}
            Your wallpaper is saving in the background.
            {remaining !== null ? ` ${remaining} free left today.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={done ? onClose : undefined}
          disabled={!done}
          aria-label={done ? "Close" : `Closes in ${left} seconds`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition",
            done ? "bg-white text-neutral-900 active:scale-95" : "cursor-default bg-white/12 tabular-nums text-white/70",
          )}
        >
          {done ? (
            <>
              Close <X className="h-4 w-4" />
            </>
          ) : (
            `${left}s`
          )}
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4">
        <AdSlot zone="idle_interstitial" dismissible={false} onResolved={setHasAd} className="w-full max-w-md" />
      </div>

      {/* The way out of seeing these, offered without nagging. */}
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-3">
        <Link
          href="/pricing"
          className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-inset ring-white/15 transition active:scale-[0.98]"
        >
          <Crown className="h-4 w-4 text-amber-300" />
          Go Pro — unlimited wallpapers, no ads
        </Link>
      </div>
    </div>
  );
}

/** Shown instead of an ad when the day's allowance is already spent. */
export function WallpaperLimitSheet({ limit, onClose }: { limit: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 rounded-3xl bg-card p-5 shadow-2xl duration-200 motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-lg shadow-amber-500/25">
            <Crown className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold">You&apos;ve used today&apos;s free wallpapers</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{wallpaperLimitMessage(limit)}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-lux btn-lux-secondary flex-1 justify-center">
            Not now
          </button>
          <Link href="/pricing" className="btn-lux btn-lux-primary flex-1 justify-center">
            See plans
          </Link>
        </div>
      </div>
    </div>
  );
}
