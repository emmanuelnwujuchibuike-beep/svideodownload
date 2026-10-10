"use client";

import { useEffect, useRef, useState } from "react";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { cardMediaBox } from "@/lib/ads-platform/media-spec";
import { dwellSeconds, VIDEO_MIN_DWELL_SECONDS } from "@/lib/ads-platform/rotation";

/** How far outside the viewport a tile/card keeps its media mounted — about a screen, so scrolling meets a ready ad. */
const MEDIA_MOUNT_MARGIN_PX = 600;
import { creativeFailed, nextFromPool, recordShown } from "@/lib/ads-platform/serving-state";
import { cn } from "@/lib/utils";

import type { AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { SelfAdCreative } from "./self-ad-creative";

/**
 * A rotating paid banner — the 32 px top strip, the 320×200 content card and
 * the square History-grid tile.
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
 *   · 0205 (owner, 2026-10-09): coming back to the app moves a timed banner on
 *     at once ("top banner rotates every 15 seconds or every time the user
 *     comes back to the app")
 *   · a format WITHOUT a timer (the download result card) shows a different ad
 *     each time it mounts — every download — never the one shown last
 */
export function SelfAdBanner({
  ads,
  rules,
  placement,
  page,
  variant,
  startAt = 0,
  className,
}: {
  ads: readonly EligibleAd[];
  rules: FormatRules | null;
  placement: string;
  page: string;
  /** "tile" = a square History-grid tile, dressed like a download beside it */
  variant: "strip" | "card" | "tile";
  /** where in the pool this unit starts, so several tiles on one page differ */
  startAt?: number;
  className?: string;
}) {
  const seconds = rules?.rotationSeconds ?? null;
  // Per-show formats start on the ad after the one this placement showed last (persisted across visits).
  // `startAt` offsets either start, so several History-grid tiles on one page differ.
  // 2026-10-10: a ROTATING placement also starts after the creative it showed last. It used to start at
  // the first ad on every mount, so the top banner showed the same creative on every page view and entry.
  const [index, setIndex] = useState(() => {
    const pick = nextFromPool(placement, ads.filter((a) => !creativeFailed(a.cr)));
    const at = pick ? ads.filter((a) => !creativeFailed(a.cr)).indexOf(pick) : 0;
    return (at < 0 ? 0 : at) + startAt;
  });
  const [, bump] = useState(0);
  const viewRef = useRef<AdView | null>(null);

  /*
    🔴 THE HISTORY CRASH (owner, 2026-10-10: "the history page always crashes when a
    video ad shows or when an ad rotates"). The History grid puts an ad tile after
    every 3 downloads, and every tile mounted its own <video> of the full creative
    and its own rotation timer — measured with 60 items: 19 tiles, 19 <video>
    elements of a 1920x1080 file at once, each remounted on every rotation. iOS
    Safari kills a tab holding that much video. Now a tile or card holds its MEDIA
    only while it is within about a screen of the viewport, and rotates only while
    visible; off-screen it keeps its box with a light sponsor placeholder. The top
    strip is always on screen and is unaffected.
  */
  const hostRef = useRef<HTMLAnchorElement | null>(null);
  const [inView, setInView] = useState(variant === "strip");
  useEffect(() => {
    if (variant === "strip") return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { rootMargin: `${MEDIA_MOUNT_MARGIN_PX}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [variant]);

  const live = ads.filter((a) => !creativeFailed(a.cr));
  const count = live.length;
  const current = count ? live[index % count]! : null;
  // 2026-10-10: how long THIS creative stays (pictures ≥5 s, videos ≥10 s — lib/ads-platform/rotation.ts),
  // and for a video, whether it has actually started playing yet
  const dwell = dwellSeconds(current?.mediaType, seconds);
  const [playingCr, setPlayingCr] = useState<string | null>(null);
  const waitingForPlay = current?.mediaType === "video" && playingCr !== current.cr;

  // Remember what this placement showed, so its NEXT mount (the next download, page view or entry) starts after it.
  useEffect(() => {
    if (!current) return;
    recordShown(placement, current.cr);
  }, [current, placement]);

  useEffect(() => {
    // an off-screen tile does not rotate (its media is not even mounted)
    if (count <= 1 || !dwell || !inView) return;
    // a video that has not started yet gets VIDEO_MIN_DWELL_SECONDS to start; once it plays, its full dwell runs from then
    const wait = (waitingForPlay ? VIDEO_MIN_DWELL_SECONDS : dwell) * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = null;
        setIndex((i) => (i + 1) % count);
      }, wait);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        // back in the app: the next ad now (the effect re-arms the timer for it)
        setIndex((i) => (i + 1) % count);
      } else if (timer) {
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
  }, [index, count, dwell, waitingForPlay, inView]);

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
        variant === "strip" ? "left-1 top-1/2 -translate-y-1/2 px-1.5 py-px text-[9px]" : variant === "tile" ? "left-1.5 top-1.5 px-2 py-0.5 text-[10px]" : "left-2 top-2 px-2 py-0.5 text-[10px]",
      )}
    >
      Ad
    </span>
  );

  // The tile's caption sits where a download's title does, over the same scrim.
  const caption =
    variant === "tile" ? (
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/25 to-transparent px-2 pb-1.5 pt-10">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-white/70">Sponsored · {current.sponsor}</span>
        {current.headline ? <span className="line-clamp-1 text-left text-[11px] font-medium text-white/95">{current.headline}</span> : null}
      </span>
    ) : null;

  const creative = (opts: { className: string; backdrop?: boolean }) =>
    !inView ? (
      <span aria-hidden className={cn(opts.className, "flex items-end bg-gradient-to-br from-slate-200 to-slate-300 p-2 dark:from-slate-800 dark:to-slate-900")}>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{current.sponsor}</span>
      </span>
    ) : (
    <SelfAdCreative
      key={current.cr}
      ad={current}
      placement={placement}
      page={page}
      // 0208: every variant shows the creative whole (contain)
      fit="contain"
      eager={variant === "strip"}
      backdrop={opts.backdrop}
      className={opts.className}
      onView={(v) => {
        viewRef.current = v;
      }}
      onPlaying={() => setPlayingCr(current.cr)}
      onFail={() => bump((n) => n + 1)}
    />
  );

  /*
    🔴 The CARD takes the creative's own shape (owner, 2026-10-10, with a
    screenshot of a TV ad squeezed into a fixed 320 × 200 box beside two blurred
    bars, and of the advertiser preview as the reference): the media at its own
    ratio inside 320 × 500 (cardMediaBox), nothing cropped, then the same row
    the preview shows — Sponsored · sponsor, headline, description, Visit.
    The box is sized from the creative's stored w × h before the bytes arrive,
    so the media loading moves nothing; a rotation to a different shape does
    resize it, which is what "not a fixed size" asks for.
  */
  if (variant === "card") {
    const box = cardMediaBox(current.w, current.h);
    return (
      <a
        ref={hostRef}
        href={current.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        onClick={(e) => {
        e.preventDefault();
        openAdDetail(current, viewRef.current);
      }}
        aria-label={`Ad from ${current.sponsor}${current.headline ? `: ${current.headline}` : ""} (opens its details)`}
        style={{ width: box.width }}
        className={cn(
          "mx-auto block max-w-full overflow-hidden rounded-[1.25rem] bg-card ring-1 ring-inset ring-black/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:ring-white/10",
          className,
        )}
      >
        <span className="relative block w-full bg-muted" style={{ aspectRatio: `${box.width} / ${box.height}` }}>
          {label}
          {creative({ className: "h-full w-full animate-in fade-in duration-300 motion-reduce:animate-none", backdrop: false })}
        </span>
        <span className="flex items-center gap-3 px-3.5 py-2.5 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-muted-foreground">Sponsored · {current.sponsor}</span>
            {current.headline ? <span className="line-clamp-2 text-[14px] font-bold leading-tight text-foreground">{current.headline}</span> : null}
            {current.body ? <span className="line-clamp-1 text-[12px] text-muted-foreground">{current.body}</span> : null}
          </span>
          <span className="shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-[12.5px] font-semibold text-background">Visit</span>
        </span>
      </a>
    );
  }

  return (
    <a
      ref={hostRef}
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
        variant === "strip"
          ? "h-8 w-full"
          : "aspect-square w-full rounded-2xl bg-black/40",
        className,
      )}
    >
      {label}
      {caption}
      {creative({ className: "h-full w-full animate-in fade-in duration-300 motion-reduce:animate-none" })}
    </a>
  );
}
