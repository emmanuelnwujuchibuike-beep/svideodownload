"use client";

import { ArrowRight, ChevronLeft, Download, Heart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { WallpaperInterstitial } from "@/features/wallpapers/wallpaper-gallery";
import { WallpaperReels } from "@/features/wallpapers/wallpaper-reels";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * /wallpapers — the standalone Wallpapers surface, opened from the landing hero.
 *
 * Owner (2026-08-03): the landing button should open "a separate page instantly
 * that has only the wallpaper section from the download page", premium, and
 * "opens the wallpaper reels when tapped … just like it does in the download
 * page". So this page IS that section, given room to breathe: a premium header,
 * the full library as a grid, and the reels viewer one tap away.
 *
 * ── Why this replaced the old straight-to-reels page ──────────────────────────
 * It used to drop the visitor directly into the viewer. That is still exactly
 * one tap away — and still the DEFAULT for entry points that mean "browse full
 * screen", which pass `?reels=1` and get the old behaviour unchanged. Keeping
 * one route with two entry modes avoids a second near-identical wallpaper page.
 *
 * ── Instant, on purpose ───────────────────────────────────────────────────────
 * Opening the viewer is client state, never a navigation: no route change, no
 * fetch, no skeleton — the artwork is already on screen, so the reveal is
 * immediate. The grid itself reveals with a short CSS-only stagger (no
 * IntersectionObserver, no JS on the scroll path) that is disabled outright
 * under `prefers-reduced-motion`.
 *
 * ── Who can do what ───────────────────────────────────────────────────────────
 * A signed-out visitor scrolls the whole library and downloads from it. Liking,
 * saving and commenting belong to signed-in members, so `canEngage` follows the
 * session; the viewer offers a sign-in rather than swallowing the tap. The
 * skippable interstitial fires from the SECOND completed download — one free
 * download before any interruption.
 */
export function WallpaperExplore({
  items,
  canEngage,
  openReels = false,
}: {
  items: Wallpaper[];
  canEngage: boolean;
  /** Entered from a "browse full screen" link — skip the grid entirely. */
  openReels?: boolean;
}) {
  const router = useRouter();
  const [viewer, setViewer] = useState<number | null>(openReels ? 0 : null);
  const [adOpen, setAdOpen] = useState(false);
  // A ref, not state: incrementing a counter must not re-render the viewer and
  // interrupt a scroll in progress.
  const downloads = useRef(0);

  const onDownloaded = useCallback(() => {
    downloads.current += 1;
    if (downloads.current >= 2) setAdOpen(true);
  }, []);

  const open = useCallback((index: number) => {
    haptic("light");
    playSound("tap");
    setViewer(index);
  }, []);

  const closeViewer = useCallback(() => {
    // Arriving via ?reels=1 means the grid was never the destination — closing
    // should leave the page, not strand the visitor on a grid they didn't ask
    // for. A visitor who opened the viewer from the grid returns to the grid.
    if (openReels) {
      if (window.history.length > 1) router.back();
      else router.push("/");
      return;
    }
    setViewer(null);
  }, [openReels, router]);

  // The library is public and can be deep-linked, so an empty one has to say so
  // rather than render an empty page with a header.
  const empty = items.length === 0;

  return (
    <>
      <main className="min-h-dvh pb-24">
        {/* Premium header — the artwork is the page, so the chrome stays quiet:
            a back affordance, the title, and a real count. Runs under the status
            bar on a phone the same way the profile covers do. */}
        <header
          className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-blue-600/15 via-violet-600/10 to-fuchsia-600/15"
          style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 1.25rem)" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl"
          />
          <div className="relative mx-auto w-full max-w-3xl px-4 pb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Home
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Wallpapers</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Tap any design to open it full screen. Free HD downloads — no account needed.
            </p>
            {!empty ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                  {items.length} design{items.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => open(0)}
                  className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-violet-500/25 transition active:scale-[0.98]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
                  />
                  <span className="relative">Browse full screen</span>
                  <ArrowRight className="relative h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="mx-auto w-full max-w-3xl px-4 pt-5">
          {empty ? (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
              No wallpapers have been published yet. Check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {items.map((wp, i) => (
                <ExploreTile key={wp.id} wp={wp} index={i} onOpen={() => open(i)} />
              ))}
            </div>
          )}
        </div>
      </main>

      {viewer !== null ? (
        <WallpaperReels
          items={items}
          startIndex={viewer}
          canEngage={canEngage}
          onClose={closeViewer}
          onDownloaded={onDownloaded}
        />
      ) : null}

      {adOpen ? <WallpaperInterstitial onClose={() => setAdOpen(false)} /> : null}
    </>
  );
}

/**
 * One grid tile. The reveal is a pure CSS animation with a capped per-tile
 * delay — no observer, no state, nothing running while the visitor scrolls, and
 * `motion-reduce` removes it entirely rather than merely shortening it.
 */
function ExploreTile({ wp, index, onOpen }: { wp: Wallpaper; index: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${wp.name}`}
      className="group relative aspect-[3/4] animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl bg-neutral-800 text-left ring-1 ring-border/50 duration-500 [animation-fill-mode:backwards] motion-reduce:animate-none"
      // Capped so a long library never staggers into a visible wait.
      style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase/R2 public CDN; next/image 403s on these */}
      <img
        src={wp.thumbUrl}
        alt={wp.name}
        loading={index < 6 ? "eager" : "lazy"}
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
        <span className="block truncate text-xs font-semibold text-white">{wp.name}</span>
        <span className="flex items-center gap-2 text-[10px] text-white/70">
          {wp.category}
          {/* Real counts only — a built-in placeholder has no row, so it shows none. */}
          {wp.likes > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Heart className="h-2.5 w-2.5" /> {wp.likes}
            </span>
          ) : null}
        </span>
      </span>
      <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition group-hover:opacity-100">
        <Download className="h-4 w-4" />
      </span>
    </button>
  );
}
