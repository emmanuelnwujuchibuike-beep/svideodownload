"use client";

import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { AdSlot } from "@/features/monetization/ad-slot";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";
import { WALLPAPERS, type Wallpaper } from "@/lib/wallpapers";

/**
 * Wallpapers section for the download page — a grid of 12 downloadable images that
 * open FULL SCREEN on tap (tap the right half for next, the left half for previous,
 * swipe down to close). After a download, a skippable interstitial ad shows and can
 * be skipped after 5 seconds (owner). Images stream through /api/wallpaper
 * (same-origin), so display + download need no CSP/CORS exception.
 *
 * Intentionally NO fabricated view/like counts (owner's "no fake stats" rule) —
 * each tile shows its real name, category and resolution.
 */

function thumb(id: string): string {
  return `/api/wallpaper?id=${id}&size=thumb`;
}
function full(id: string): string {
  return `/api/wallpaper?id=${id}&size=full`;
}

function tap() {
  haptic("light");
  playSound("tap");
}

export function WallpaperGallery() {
  const [viewer, setViewer] = useState<number | null>(null);
  const [adOpen, setAdOpen] = useState(false);

  const download = useCallback((wp: Wallpaper) => {
    haptic("selection");
    playSound("tap");
    startDownload({
      url: `/api/wallpaper?id=${wp.id}&size=full`,
      formatId: "wallpaper",
      kind: "image",
      title: `${wp.name} wallpaper`,
      thumbnail: thumb(wp.id),
      platform: "generic",
      platformName: "Wallpaper",
      qualityLabel: "1080 × 1920",
      directUrl: `/api/wallpaper?id=${wp.id}&size=full&dl=1`,
    });
    setAdOpen(true);
  }, []);

  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Wallpapers</h2>
          <p className="text-xs text-muted-foreground">Tap to preview full screen · free HD downloads</p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{WALLPAPERS.length} designs</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {WALLPAPERS.map((wp, i) => (
          <WallpaperTile key={wp.id} wp={wp} onOpen={() => setViewer(i)} onDownload={() => download(wp)} />
        ))}
      </div>

      {viewer !== null ? (
        <WallpaperViewer
          items={WALLPAPERS}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onDownload={download}
        />
      ) : null}

      {adOpen ? <WallpaperInterstitial onClose={() => setAdOpen(false)} /> : null}
    </section>
  );
}

function WallpaperTile({ wp, onOpen, onDownload }: { wp: Wallpaper; onOpen: () => void; onDownload: () => void }) {
  return (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-neutral-800 ring-1 ring-border/50">
      <button type="button" onClick={onOpen} className="absolute inset-0" aria-label={`Preview ${wp.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(wp.id)} alt={wp.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 text-left">
          <span className="block truncate text-xs font-semibold text-white">{wp.name}</span>
          <span className="block text-[10px] text-white/70">{wp.category}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDownload}
        aria-label={`Download ${wp.name}`}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65 active:scale-90"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

function WallpaperViewer({
  items,
  index,
  onIndex,
  onClose,
  onDownload,
}: {
  items: Wallpaper[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDownload: (wp: Wallpaper) => void;
}) {
  const wp = items[index]!;
  const [loaded, setLoaded] = useState(false);
  const dragY = useRef<number | null>(null);
  const [dy, setDy] = useState(0);

  const go = useCallback(
    (dir: 1 | -1) => {
      tap();
      setLoaded(false);
      onIndex((index + dir + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  // Keyboard: ← → to navigate, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex touch-none select-none flex-col bg-black"
      style={{ transform: dy ? `translateY(${dy}px)` : undefined, opacity: dy ? Math.max(0.4, 1 - dy / 400) : 1 }}
      onPointerDown={(e) => {
        dragY.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (dragY.current === null) return;
        const d = e.clientY - dragY.current;
        if (d > 0) setDy(d);
      }}
      onPointerUp={() => {
        if (dy > 90) onClose();
        setDy(0);
        dragY.current = null;
      }}
    >
      {/* Top bar */}
      <div
        className="relative z-10 flex items-center justify-between px-4 text-white"
        style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 0.75rem)" }}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{wp.name}</p>
          <p className="text-xs text-white/60">{wp.category} · {index + 1}/{items.length}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-white/10 p-2 backdrop-blur-md transition active:scale-90">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image + tap zones */}
      <div className="relative flex-1 overflow-hidden">
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-white/50" />
          </div>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={wp.id}
          src={full(wp.id)}
          alt={wp.name}
          onLoad={() => setLoaded(true)}
          className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        />
        {/* Left half = previous, right half = next. */}
        <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/2" />
        <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/2" />

        {/* Nav hints */}
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-white/30"><ChevronLeft className="h-7 w-7" /></div>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/30"><ChevronRight className="h-7 w-7" /></div>
      </div>

      {/* Bottom download */}
      <div className="relative z-10 flex justify-center px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)", paddingTop: "0.75rem" }}>
        <button
          type="button"
          onClick={() => onDownload(wp)}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/30 transition active:scale-95"
        >
          <Download className="h-4 w-4" /> Download HD
        </button>
      </div>
    </div>
  );
}

/** Full-screen interstitial after a wallpaper download — skippable after 5s. */
function WallpaperInterstitial({ onClose }: { onClose: () => void }) {
  const { showAds, ready } = useShowAds();
  const [left, setLeft] = useState(5);
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  // Premium users, or no ad to show → don't interrupt them at all.
  useEffect(() => {
    if (ready && !showAds) onClose();
  }, [ready, showAds, onClose]);
  useEffect(() => {
    if (hasAd === false) onClose();
  }, [hasAd, onClose]);

  if (!ready || !showAds) return null;

  const canSkip = left <= 0;

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/95 backdrop-blur-sm">
      <div className="flex justify-end p-4" style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 1rem)" }}>
        <button
          type="button"
          onClick={canSkip ? onClose : undefined}
          disabled={!canSkip}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition",
            canSkip ? "bg-white text-neutral-900 active:scale-95" : "cursor-default bg-white/15 text-white/70",
          )}
        >
          {canSkip ? (
            <>
              Skip <X className="h-4 w-4" />
            </>
          ) : (
            `Skip in ${left}s`
          )}
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-10">
        <AdSlot zone="idle_interstitial" dismissible={false} onResolved={setHasAd} className="w-full max-w-md" />
      </div>
    </div>
  );
}
