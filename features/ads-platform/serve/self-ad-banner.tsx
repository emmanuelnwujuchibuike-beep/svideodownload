"use client";

import { useEffect, useRef, useState } from "react";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { creativeFailed } from "@/lib/ads-platform/serving-state";
import { cn } from "@/lib/utils";

import type { AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { SelfAdCreative } from "./self-ad-creative";

/**
 * A rotating paid banner — the 32 px top strip and the 320×200 content card.
 *
 * 🔴 The rotation is LOCAL. The pool (up to the format's slot count, 10 by
 * default) arrived once with the cached payload; every `rotationSeconds` (the
 * admin's number, 5 s by default) this moves an index. ONE `setTimeout` at a
 * time, no interval, and never a request — `rotation.test.ts` scans for it.
 *
 *   · the timer stops while the tab is hidden and on unmount
 *   · only the CURRENT creative's media is fetched; the next one is warmed
 *     only when it is an image (a video is never preloaded)
 *   · a creative that fails is skipped at once and the rotation continues
 *   · reduced motion keeps the swap but drops the cross-fade
 */
export function SelfAdBanner({
  ads,
  rules,
  placement,
  page,
  variant,
  className,
}: {
  ads: readonly EligibleAd[];
  rules: FormatRules | null;
  placement: string;
  page: string;
  variant: "strip" | "card";
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [, bump] = useState(0);
  const viewRef = useRef<AdView | null>(null);

  const live = ads.filter((a) => !creativeFailed(a.cr));
  const count = live.length;
  const current = count ? live[index % count]! : null;
  const seconds = rules?.rotationSeconds ?? null;

  useEffect(() => {
    if (count <= 1 || !seconds || seconds <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = null;
        setIndex((i) => (i + 1) % count);
      }, seconds * 1000);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") arm();
      else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [index, count, seconds]);

  // Warm ONLY the next creative, and only an image.
  useEffect(() => {
    if (count <= 1) return;
    const next = live[(index + 1) % count];
    if (next?.mediaType !== "image") return;
    const img = new Image();
    img.decoding = "async";
    img.src = next.media;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  if (!current) return null;

  const label = (
    <span
      className={cn(
        "pointer-events-none absolute z-10 rounded-full bg-black/55 font-semibold uppercase tracking-[0.06em] text-white backdrop-blur-sm",
        variant === "strip" ? "left-1 top-1/2 -translate-y-1/2 px-1.5 py-px text-[9px]" : "left-2 top-2 px-2 py-0.5 text-[10px]",
      )}
    >
      Ad
    </span>
  );

  return (
    <a
      href={current.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      // 2026-10-09 (owner): a tap opens the ad's details on this page (click + conversion); the link itself waits behind an external-link warning
      onClick={(e) => {
        e.preventDefault();
        openAdDetail(current, viewRef.current);
      }}
      aria-label={`Ad from ${current.sponsor}${current.headline ? `: ${current.headline}` : ""} (opens its details)`}
      className={cn(
        "relative block overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        variant === "strip" ? "h-8 w-full" : "aspect-[320/200] w-full rounded-[1.25rem] bg-muted ring-1 ring-inset ring-black/[0.06] dark:ring-white/10",
        className,
      )}
    >
      {label}
      <SelfAdCreative
        key={current.cr}
        ad={current}
        placement={placement}
        page={page}
        fit={variant === "strip" ? "contain" : "cover"}
        eager={variant === "strip"}
        className="h-full w-full animate-in fade-in duration-300 motion-reduce:animate-none"
        onView={(v) => {
          viewRef.current = v;
        }}
        onFail={() => bump((n) => n + 1)}
      />
    </a>
  );
}
