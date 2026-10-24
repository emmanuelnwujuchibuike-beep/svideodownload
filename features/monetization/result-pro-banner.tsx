"use client";

import { ChevronRight, Crown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { useShowAds } from "./use-show-ads";

/**
 * The Upgrade-to-Pro banner at the bottom of the download result card, under the Download button (owner, 2026-10-24:
 * "put the pro price there, don't cluster there with pro features writing, only show the upgrade to pro for ad free
 * and faster download, with more features across the app").
 *
 * One line, one price — the full list lives on /pricing and the Downloads page card (tired-of-ads.tsx).
 *
 * Wording is held to what Pro actually does (lib/monetization/plan-features.ts): Pro removes the ad BEFORE a download
 * (the reward gate), which is what makes the file arrive sooner. It does not speed the pipeline up and Pro still sees
 * the result-page ad, so the line says "no ads before your downloads", never a flat "ad-free" or "faster servers".
 *
 * `useShowAds()` with no placement is false for Pro and Business: a paying member never sees it. The price is the
 * Admin → Pricing display price from /api/pricing, fetched once per page load AFTER a result appears (never at first
 * paint — the cold-entry budget), and the banner shows no price rather than a made-up one if that read fails.
 */
let pricePromise: Promise<string | null> | null = null;
function loadProPrice(): Promise<string | null> {
  pricePromise ??= fetch("/api/pricing")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { pro?: { price?: string; period?: string } } | null) => (j?.pro?.price ? `${j.pro.price}${j.pro.period ?? ""}` : null))
    .catch(() => {
      pricePromise = null;
      return null;
    });
  return pricePromise;
}

export function ResultProBanner({ className }: { className?: string }) {
  const { showAds, ready } = useShowAds();
  const [price, setPrice] = useState<string | null>(null);
  const show = ready && showAds;

  useEffect(() => {
    if (!show) return;
    let live = true;
    void loadProPrice().then((p) => live && setPrice(p));
    return () => {
      live = false;
    };
  }, [show]);

  if (!show) return null;
  return (
    <Link
      href="/pricing"
      className={cn(
        "group flex items-center gap-3 rounded-2xl border border-violet-500/25 bg-gradient-to-r from-blue-600/[0.08] via-violet-600/[0.09] to-fuchsia-600/[0.08] px-3.5 py-3 transition hover:border-violet-500/45",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25">
        <Crown className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-tight">
          Upgrade to Pro{price ? <span className="font-semibold text-violet-600 dark:text-violet-400"> · {price}</span> : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">No ads before your downloads, so files come faster — plus more across the app.</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
