"use client";

import { ArrowRight, Download, Heart, Loader2, Share2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AdSlot } from "@/features/monetization/ad-slot";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { useInterstitialConfig } from "@/features/monetization/use-interstitial-skip";
import { WallpaperReels } from "@/features/wallpapers/wallpaper-reels";
import { useWallpaperInterstitial } from "@/features/wallpapers/use-wallpaper-interstitial";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * The download page's Wallpapers section — a grid that opens the REELS viewer.
 *
 * Owner: "any wallpaper click should be scrollable like the reels format", plus
 * a "See more" at the bottom that opens the same viewer from the top. So there
 * is exactly one way to look at a wallpaper here, and it is the reels one; the
 * grid is only an index into it.
 *
 * Engagement (like / save / comment) is enabled on this surface for signed-in
 * members — this IS the download page. The standalone /wallpapers page passes
 * `canEngage={false}` for signed-out visitors.
 */

const PREVIEW_COUNT = 6;

export function WallpaperGallery({ items, canEngage }: { items: Wallpaper[]; canEngage: boolean }) {
  const [viewer, setViewer] = useState<number | null>(null);
  // Every 2nd wallpaper download, not every one (owner, 2026-08-04). This used
  // to fire an interstitial on EVERY download here while the standalone
  // /wallpapers page fired from the 2nd onwards — the shared hook is what keeps
  // the two surfaces telling the same story.
  const { adOpen, onDownloaded, close: closeAd } = useWallpaperInterstitial();

  if (items.length === 0) return null;
  const preview = items.slice(0, PREVIEW_COUNT);

  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Wallpapers</h2>
          <p className="text-xs text-muted-foreground">Tap to open full screen · free HD downloads</p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {items.length} designs
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {preview.map((wp, i) => (
          <WallpaperTile key={wp.id} wp={wp} onOpen={() => setViewer(i)} />
        ))}
      </div>

      {canEngage ? <ShareYourOwn /> : null}

      {/* See more — opens the reels viewer from the beginning (owner). */}
      <button
        type="button"
        onClick={() => {
          haptic("light");
          playSound("tap");
          setViewer(0);
        }}
        className="group relative mt-3 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition active:scale-[0.99]"
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full" />
        <span className="relative">See more wallpapers</span>
        <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>

      {viewer !== null ? (
        <WallpaperReels
          items={items}
          startIndex={viewer}
          canEngage={canEngage}
          onClose={() => setViewer(null)}
          onDownloaded={onDownloaded}
        />
      ) : null}

      {adOpen ? <WallpaperInterstitial onClose={closeAd} /> : null}
    </section>
  );
}

function WallpaperTile({ wp, onOpen }: { wp: Wallpaper; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${wp.name}`}
      className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-neutral-800 text-left ring-1 ring-border/50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={wp.thumbUrl}
        alt={wp.name}
        loading="lazy"
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

/**
 * "Share yours" — a signed-in member publishes one of their own images into the
 * public library (owner). It appears alongside the curated ones, and other
 * members can like and comment on it.
 */
function ShareYourOwn() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const share = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Shared wallpaper");
      const res = await fetch("/api/wallpapers/share", { method: "POST", body: form });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMsg({ ok: true, text: "Shared — it's in the library now." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: json.error ?? "Couldn't share that." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="mt-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void share(f);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        {busy ? "Sharing…" : "Share one of yours to the library"}
      </button>
      {msg ? (
        <p className={cn("mt-1.5 text-center text-xs font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
      ) : null}
    </div>
  );
}

/**
 * Full-screen interstitial after a wallpaper download — skippable after 5s.
 * Premium members, and anyone with no ad to show, are never interrupted.
 */
export function WallpaperInterstitial({ onClose }: { onClose: () => void }) {
  const { showAds, ready } = useShowAds();
  // The admin's skip delay (0 / 5 / 10), not a hardcoded 5 — the same setting
  // the download-flow interstitial obeys, so both behave identically.
  const { skipSeconds } = useInterstitialConfig();
  const [left, setLeft] = useState(skipSeconds);
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  // Re-seed if the config resolves after mount, then count down. Depending on
  // `skipSeconds` rather than running once is what stops the countdown being
  // stuck at the default when the fetch lands a moment later.
  useEffect(() => {
    setLeft(skipSeconds);
    if (skipSeconds <= 0) return;
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [skipSeconds]);

  // A premium member, or no ad to fill the slot → don't interrupt at all.
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
