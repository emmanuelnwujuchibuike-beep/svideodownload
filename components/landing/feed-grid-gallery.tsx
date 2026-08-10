"use client";

import { ChevronLeft, ChevronRight, Download, Heart, Loader2, Play, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * The interactive 2×2 feed grid — the admin images (Admin → Landing page), each a
 * button that opens a full-screen viewer with a Download button (owner,
 * 2026-07-26: "users can click and view the images … in fullscreen and download it
 * to their device").
 *
 * A client island inside the otherwise-static CreatorsSection, so `/` stays
 * prerendered. Empty cells fall back to a branded gradient and are NOT interactive,
 * so a half-filled grid still reads as intentional. Download goes through
 * /api/landing/grid-image (same-origin, attachment) for cross-origin storage URLs,
 * with the iOS share sheet as the path to the Photos library; a root-relative asset
 * is downloaded directly.
 */

const TINTS = [
  "from-rose-500/70 to-fuchsia-600/70",
  "from-blue-500/70 to-indigo-600/70",
  "from-violet-500/70 to-purple-600/70",
  "from-sky-500/70 to-cyan-600/70",
] as const;

/*
  @sourced illustrative — decorative engagement for this marketing panel ONLY, the
  same documented exception as lib/content/showcase-stats.ts. Never real statistics.
*/
const META = [
  { views: "41.2K", likes: "3.8K" },
  { views: "28.4K", likes: "2.1K" },
  { views: "63.1K", likes: "5.4K" },
  { views: "19.7K", likes: "1.5K" },
] as const;

export function FeedGridGallery({ images }: { images: string[] }) {
  // `open` indexes into the FULL 4-cell grid (so the viewer's prev/next skips empty
  // cells). null = closed.
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // The viewer is PORTALLED to <body> (below). It has to be: the landing's
  // below-the-fold sections live inside a `content-visibility:auto` wrapper, whose
  // `contain: paint` makes it the containing block for `position: fixed`, and this
  // panel is `overflow-hidden` — so an in-tree overlay would be clipped to the tiny
  // 4:5 box instead of covering the screen. Portalling escapes both. `mounted`
  // gates it so the first client render matches the server (no portal on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const filled = images.map((url, i) => ({ url, i })).filter((c) => !!c.url);
  const cells = Array.from({ length: 4 }, (_, i) => images[i] ?? null);

  const openAt = useCallback((i: number) => setOpen(i), []);
  const close = useCallback(() => setOpen(null), []);

  const step = useCallback(
    (dir: 1 | -1) => {
      setOpen((cur) => {
        if (cur === null || filled.length === 0) return cur;
        const pos = filled.findIndex((c) => c.i === cur);
        const next = filled[(pos + dir + filled.length) % filled.length];
        return next ? next.i : cur;
      });
    },
    [filled],
  );

  // Esc closes, arrows navigate, and the page is scroll-locked while the viewer is
  // open — `overflowY` only, the convention here (locking `overflow` also kills
  // horizontal clipping and shifts the layout).
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    const previous = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, step]);

  const download = useCallback(async (url: string) => {
    setBusy(true);
    try {
      const name = `frenz-${Date.now()}.jpg`;

      // A same-origin asset downloads directly; a remote storage URL goes through
      // the same-origin proxy so the attachment header (and iOS) behave.
      if (url.startsWith("/")) {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      const res = await fetch(
        `/api/landing/grid-image?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });

      // iOS: the share sheet is the only route to the Photos library.
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file] });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return; // user dismissed
          // NotAllowedError (gesture spent by the await) falls through to <a download>.
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      // Last resort: open the image so the visitor can save it manually.
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }, []);

  const current = open !== null ? images[open] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        {cells.map((url, i) => {
          const tile = (
            <>
              {url ? (
                /*
                  🔴 `next/image`, not a raw <img> (owner Lighthouse, 2026-08-10).

                  Lighthouse named these tiles in "Avoid enormous network
                  payloads": full-size originals straight out of the bucket —
                  measured at 545 KB, 544 KB, 253 KB, 202 KB and 155 KB for
                  tiles that render about 160px wide on a phone. That is most of
                  the 3,448 KiB the page still weighs, and it is bytes spent on
                  pixels no screen displays.

                  The optimizer resizes to the requested width and serves AVIF
                  or WebP, both of which `next.config` already configures, with
                  a 31-day cache on the variant. `sizes` is what makes that
                  work — without it the optimizer assumes full viewport width
                  and the saving mostly evaporates.

                  This is safe HERE specifically, and the distinction matters:
                  `next/image` 403s on the platform CDNs our media comes from
                  (a recorded failure in this codebase), because those hosts
                  reject Vercel's fetcher. This bucket is ours and public, so
                  there is nothing to reject.
                */
                <Image
                  src={url}
                  alt=""
                  fill
                  // Two columns on a phone, a fixed-width tile once the grid
                  // stops growing.
                  sizes="(max-width: 640px) 50vw, 320px"
                  loading="lazy"
                  /*
                    🔴 `object-contain`, NOT `object-cover` (owner, 2026-08-10:
                    "the other section in my screenshot is showing zoom when i
                    upload it, i want it to show the full image in full without
                    zooming, unless i zoom it").

                    `object-cover` scales an image up until it fills the tile and
                    discards the overflow — which is exactly the "zoom" being
                    reported. These tiles are a fixed 3:4-ish box and the admin
                    uploads whatever shape they have, so a wide image lost its
                    sides and a tall one lost its top and bottom. On an
                    admin-curated grid that is the whole point of the upload
                    being thrown away: the operator chose that framing.

                    `contain` fits the entire image inside the tile. The
                    letterbox it leaves is filled by the tile's own dark ground
                    rather than by stretching, so a half-filled grid still reads
                    as intentional — the same treatment the reel player uses over
                    its blurred backdrop, for the same reason.

                    The hover scale stays: that is a deliberate, user-initiated
                    magnification ("unless i zoom it"), not a silent crop.
                  */
                  className="object-contain transition-transform duration-500 group-hover/tile:scale-[1.05]"
                />
              ) : null}
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
              <span
                aria-hidden
                className="relative m-2 flex items-center gap-2 text-[9px] font-semibold text-white/90"
              >
                <span className="flex items-center gap-1">
                  <Play className="h-2.5 w-2.5 fill-white/90" /> {META[i]!.views}
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="h-2.5 w-2.5 fill-white/90" /> {META[i]!.likes}
                </span>
              </span>
            </>
          );

          const base = `group/tile relative flex aspect-[4/5] items-end overflow-hidden rounded-xl bg-gradient-to-br ${TINTS[i]} shadow-lg ring-1 ring-white/20`;

          return url ? (
            <button
              key={i}
              type="button"
              onClick={() => openAt(i)}
              aria-label={`View image ${i + 1} full screen`}
              className={cn(base, "cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white")}
            >
              {tile}
            </button>
          ) : (
            <span key={i} aria-hidden className={base}>
              {tile}
            </span>
          );
        })}
      </div>

      {/* Full-screen viewer — portalled to <body> so it clears the panel's
          overflow-hidden and the content-visibility containing block. */}
      {mounted && current
        ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={close}
        >
          {/* Close */}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-[max(0.75rem,var(--frenz-safe-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Prev / next — only when there is more than one image */}
          {filled.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Next image"
                className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}

          {/* The image — stop propagation so clicking it doesn't close the viewer */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />

          {/* Download */}
          <div className="absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (current) void download(current);
              }}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 shadow-xl transition hover:bg-white/90 disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy ? "Saving…" : "Download"}
            </button>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
