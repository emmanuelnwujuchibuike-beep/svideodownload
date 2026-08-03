"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A persistent ad bar pinned to the TOP of the viewport, directly below the header
 * (owner, 2026-08-03: "a top banner ad like the bottom banner ad … show in other
 * pages, history, academy, seo pages … but not in the social pages").
 *
 * ── Where it shows ────────────────────────────────────────────────────────────
 * Mounted from the MARKETING layout, so social pages (the `(app)` route group) never
 * get it. Within marketing it is additionally hidden on the home page and the
 * download-focused pages (`/`, `/library`) — the surfaces that own the paste box —
 * per the brief. So it appears on history, academy, blog, help and the SEO
 * downloader pages, and not where a download flow is happening.
 *
 * Fixed at `--frenz-header-bottom`; publishes its height as `--frenz-topbanner-h`
 * (the same reservation var the announcement bar uses — the two never show on the
 * same page) so page content clears it. Collapses to nothing when the zone is
 * unseeded, so an ad-free site keeps its exact layout.
 */

// Paths that own a download/paste flow — no top ad here (home + guest library).
const HIDDEN_PATHS = new Set(["/", "/library"]);

export function TopPageBannerAd() {
  const pathname = usePathname();
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const allowedPath = !HIDDEN_PATHS.has(pathname);
  const visible = allowedPath && hasAd === true;

  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !barRef.current) {
      root.style.setProperty("--frenz-topbanner-h", "0px");
      return;
    }
    const bar = barRef.current;
    const set = () => root.style.setProperty("--frenz-topbanner-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-topbanner-h", "0px");
    };
  }, [visible]);

  if (!ready || !showAds || !allowedPath) return null;

  return (
    <div
      ref={barRef}
      style={{ top: "var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem))" }}
      className={cn(
        // z-40: below the header (z-50), above content — matches the bottom bar.
        "fixed inset-x-0 z-40 border-b border-border/60 bg-card",
        !visible && "hidden",
      )}
      aria-hidden={!visible}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center px-3 py-2">
        <AdSlot zone="top_banner" dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
