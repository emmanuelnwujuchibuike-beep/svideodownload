"use client";

import { Crown, Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { useShowAds } from "./use-show-ads";

/**
 * The premium "tired of ads → upgrade to Pro" banner.
 *
 * Gated on `useShowAds()`, which is already false for Pro and Business — so a
 * paying visitor NEVER sees an upgrade-to-Pro message, per the owner's rule. It's
 * the positive counterpart to the ad slots on the download page: the one place
 * that turns the ads into a reason to upgrade, leading straight to /pricing.
 */
export function TiredOfAds({ className }: { className?: string }) {
  const { showAds, ready } = useShowAds();
  if (!ready || !showAds) return null;

  return (
    <Link
      href="/pricing"
      className={cn(
        "group relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-r from-blue-600/10 via-violet-600/10 to-fuchsia-600/10 p-4 shadow-soft transition hover:border-violet-500/40 sm:p-5",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/25">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold sm:text-base">Tired of ads?</p>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Upgrade to Pro for an ad-free library, more storage and faster downloads.
          </p>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25">
        <Crown className="h-4 w-4" /> Go Pro
      </span>
    </Link>
  );
}
