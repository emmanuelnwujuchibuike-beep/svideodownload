"use client";

import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { useSlotProvider } from "@/features/ads-platform/serve/use-slot-provider";
import { pageForPath } from "@/lib/ads-platform/pages";

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

// Ad Platform Part 5: the paid provider's renderer, fetched only when a campaign occupies this slot
const SelfTopCreative = dynamic(() => import("@/features/ads-platform/serve/self-top-creative").then((m) => m.SelfTopCreative), { ssr: false });

// Paths that own a download/paste flow — no top ad here (home + guest library).
const HIDDEN_PATHS = new Set(["/", "/library"]);

export function TopPageBannerAd() {
  const pathname = usePathname();
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  /*
    Ad Platform Part 5 — this container IS the canonical `top_banner` slot
    (lib/ads-platform/slot-registry.ts). The resolver picks ONE provider — a
    paid campaign (placement global_top_banner) or the network zone below —
    and only that one is mounted, in this same frame.
  */
  const { state: occupant, networkEmpty } = useSlotProvider("top_banner", pageForPath(pathname));
  const paid = occupant.status === "ready" && occupant.provider === "frenzsave" ? occupant : null;
  const network = occupant.status === "ready" && occupant.provider === "network";
  const allowedPath = !HIDDEN_PATHS.has(pathname);
  const visible = allowedPath && (!!paid || (network && hasAd === true));

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
      // Sits BELOW the global announcement bar (if one is showing) — offset by its
      // published height so the two never overlap.
      style={{ top: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + var(--frenz-announce-h, 0px))" }}
      data-ad-slot="top_banner"
      data-ad-provider={paid ? "frenzsave" : "network"}
      className={cn(
        // z-40: below the header (z-50), above content — matches the bottom bar.
        "fixed inset-x-0 z-40 border-b border-border/60 bg-card",
        !visible && "hidden",
      )}
      aria-hidden={!visible}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center px-3 py-2">
        {paid ? (
          <SelfTopCreative ads={paid.ads} rules={paid.rules} page={pageForPath(pathname) ?? "all_pages"} />
        ) : network ? (
          <AdSlot
            zone="top_banner"
            dismissible={false}
            onResolved={(has) => {
              setHasAd(has);
              if (!has) networkEmpty();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
