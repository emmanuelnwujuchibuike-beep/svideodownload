"use client";

import { Heart, MessageCircle, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MockReel {
  id: string;
  thumbnailUrl: string;
  mediaUrl: string;
  viewsCount: number;
  title: string;
}

/** How many clips we're willing to warm. Matches the owner's "first 4". */
const WARM_COUNT = 4;

/**
 * Should we spend the visitor's data warming clips they may never play?
 *
 * The landing page is the first thing a stranger loads, often on mobile data in a
 * region where it's expensive — so warming is a privilege, not a default. Skip it
 * outright on Save-Data or anything slower than 4g. `connection` is Chromium-only;
 * everywhere else we warm, which is the same bet the rest of the page already makes.
 */
function shouldWarm(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!c) return true;
  if (c.saveData) return false;
  return c.effectiveType === undefined || c.effectiveType === "4g";
}

/**
 * The hero phone's reels deck — the real /reels experience, scaled into the mockup.
 *
 * Mirrors features/reels/reel-viewer.tsx's actual mechanics rather than imitating
 * them: a native snap-scrolling column (`snap-y snap-mandatory`), one full-bleed
 * clip per panel, muted autoplay on the active clip only. Scrolling is the browser's,
 * not a JS carousel, so it's smooth on a mid-range phone and costs no main thread.
 *
 * DATA / "INSTANT OPEN", the honest version:
 *   - The poster is what makes the open instant. It's already decoded (it's the tile
 *     the visitor just tapped), so the first frame paints immediately and the video
 *     starts underneath it. That's the TikTok trick, and it costs zero extra bytes.
 *   - Warming is `preload="metadata"` on the first 4 — headers only, a few KB each,
 *     enough that DNS/TLS/the moov atom are hot when the deck opens. NOT
 *     `preload="auto"`: pulling 4 full clips onto the landing page for visitors who
 *     may never press play is exactly the kind of thing that burned this project's
 *     egress cap once already.
 *   - Only the ACTIVE clip gets `preload="auto"` and plays. Everything else is
 *     paused and unbuffered.
 *   - Warming waits for idle, so it can never compete with the hero's LCP.
 */
export function PhoneReels({ reels }: { reels: MockReel[] }) {
  const [open, setOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [active, setActive] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const viewed = useRef<Set<string>>(new Set());

  // Warm on idle, never on load — the <h1> is the LCP element and nothing here may
  // queue in front of it.
  useEffect(() => {
    if (!shouldWarm()) return;
    const start = () => setWarm(true);
    // requestIdleCallback is unsupported on Safari <16.4; fall back to a timeout
    // long enough to be safely past LCP either way.
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(start) : window.setTimeout(start, 2500);
    return () => {
      if (idle) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);

  /**
   * Count a view the moment a clip actually plays — including for signed-out
   * visitors. The endpoint already accepts an anonymous viewer and dedupes per
   * (ip, post, day) via `coalesce(viewer_id::text, ip_hash)`, so a replay can't
   * inflate anything. Fire-and-forget; a failed count must never break playback.
   */
  const countView = useCallback((id: string) => {
    if (viewed.current.has(id)) return;
    viewed.current.add(id);
    fetch(`/api/posts/${id}/view`, { method: "POST", keepalive: true }).catch(() => {});
  }, []);

  // Play only what's on screen. One IntersectionObserver over the panels, not a
  // scroll handler — no per-frame work.
  useEffect(() => {
    if (!open) return;
    const root = scrollerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          const v = videoRefs.current[i];
          if (!v) continue;
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            setActive(i);
            v.play().then(() => countView(reels[i]!.id)).catch(() => {});
          } else {
            v.pause();
          }
        }
      },
      { root, threshold: [0, 0.6, 1] },
    );
    for (const el of root.querySelectorAll("[data-i]")) io.observe(el);
    return () => io.disconnect();
  }, [open, reels, countView]);

  // Pause everything on close so nothing keeps streaming off-screen.
  useEffect(() => {
    if (open) return;
    for (const v of videoRefs.current) v?.pause();
  }, [open]);

  const lead = reels[0];
  const second = reels[1];
  if (!lead) return null;

  return (
    <>
      {/* Closed state — the row of tiles */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Play trending reels"
          className="relative h-28 flex-1 overflow-hidden rounded-xl bg-neutral-800"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lead.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] font-medium text-white">
            <Play className="h-2.5 w-2.5" /> {compact(lead.viewsCount)}
          </span>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25 backdrop-blur">
              <Play className="h-4 w-4 fill-white text-white" />
            </span>
          </span>
        </button>
        <div className="relative h-28 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
          {second ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={second.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
        </div>
      </div>

      {/* Warm-up. Rendered only once idle + on a connection that can afford it.
          `preload="metadata"` = headers only. No poster here on purpose: the tiles
          above already hold the same images, so this fetches no pixels. */}
      {warm && !open
        ? reels.slice(0, WARM_COUNT).map((r) => (
            <video key={`warm-${r.id}`} src={r.mediaUrl} preload="metadata" muted playsInline className="hidden" />
          ))
        : null}

      {/* Open state — the real deck, inside the phone. `absolute inset-0` resolves
          to the screen box (the frame's inner div is the positioned ancestor), so it
          fills the display exactly and never escapes the bezel. z-10 keeps it under
          the glass sheen + Dynamic Island, which still read as glass on top. */}
      {open ? (
        // `data-deck-open` is read by the wrapper in phone-mockup.tsx (via
        // `group-has-*`) to fade out the download callout: the deck is fullscreen
        // — as the real /reels is — so it covers the tab bar, and an arrow pointing
        // at a + that isn't on screen is worse than no arrow. Pure CSS; no state to
        // lift out of this component.
        <div data-deck-open className="absolute inset-0 z-10 bg-black">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close reels"
            className="absolute right-2 top-8 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div
            ref={scrollerRef}
            className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {reels.map((r, i) => (
              <section key={r.id} data-i={i} className="relative h-full w-full shrink-0 snap-start snap-always bg-black">
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={r.mediaUrl}
                  poster={r.thumbnailUrl}
                  // Only the active clip buffers. `metadata` for the warm window,
                  // `none` past it — a deck of 24 must not become 24 downloads.
                  preload={i === active ? "auto" : i < WARM_COUNT ? "metadata" : "none"}
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

                {/* Action rail — mirrors the real deck's right-hand column */}
                <span className="pointer-events-none absolute bottom-16 right-1.5 flex flex-col items-center gap-2.5 text-white">
                  <span className="flex flex-col items-center gap-0.5">
                    <Heart className="h-4 w-4" />
                    <span className="text-[7px] font-semibold">{compact(Math.round(r.viewsCount / 8))}</span>
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-[7px] font-semibold">{compact(Math.round(r.viewsCount / 20))}</span>
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <Play className="h-4 w-4" />
                    <span className="text-[7px] font-semibold">{compact(r.viewsCount)}</span>
                  </span>
                </span>

                <span className="pointer-events-none absolute inset-x-2 bottom-9 text-white">
                  <span className="block truncate text-[9px] font-bold">{r.title || "Trending on Frenz"}</span>
                </span>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

const nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function compact(n: number): string {
  return nf.format(Math.max(0, n));
}
