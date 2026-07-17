"use client";

import { Heart, MessageCircle, Play, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MockReel {
  id: string;
  thumbnailUrl: string;
  mediaUrl: string;
  /** Illustrative engagement for the mockup — see `showcaseStats`. */
  viewsCount: number;
  likesCount: number;
  title: string;
}

// showcaseStats lives in ./showcase-stats.ts — a plain module, so the SERVER
// component PhoneMockup can call it (a "use client" export can't be invoked from
// the server; doing so was a build-breaking prerender error).

/** How many clips we're willing to warm. Matches the owner's "first 4". */
const WARM_COUNT = 4;

/**
 * Should we spend the visitor's data warming clips they may never play?
 *
 * The landing page is the first thing a stranger loads, often on mobile data in a
 * region where it's expensive — so warming is a privilege, not a default.
 *
 * `effectiveType === "4g"` ALONE is far too permissive and actively hurt us: the
 * Network Information API reports "4g" for anything above ~700kbps, so a genuinely
 * slow phone still qualified and we'd start pulling a multi-megabyte clip, saturating
 * the very link the visitor then needs to actually play it. Reels here are raw MP4
 * (Cloudflare Stream is not configured — no adaptive ladder), and they run to ~5.5MB;
 * at ~250kbps that's ~3 minutes, which is exactly the owner's "on the webapp the
 * videos take about 3 minutes". So gate on measured `downlink` too, and only warm
 * when there is real headroom.
 */
const MIN_DOWNLINK_MBPS = 2.5;

function shouldWarm(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
    }
  ).connection;
  // No Network Information API (Safari/Firefox) — don't gamble a stranger's data on
  // an unknown link. Warming is an optimisation; skipping it only costs a spinner.
  if (!c) return false;
  if (c.saveData) return false;
  if (c.effectiveType !== "4g") return false;
  return typeof c.downlink === "number" && c.downlink >= MIN_DOWNLINK_MBPS;
}

/**
 * The hero phone's reels deck — the real /reels experience, scaled into the mockup.
 *
 * Mirrors features/reels/reel-viewer.tsx's actual mechanics rather than imitating
 * them: a native snap-scrolling column (`snap-y snap-mandatory`), one full-bleed
 * clip per panel, muted autoplay on the active clip only. Scrolling is the browser's,
 * not a JS carousel, so it's smooth on a mid-range phone and costs no main thread.
 *
 * DATA vs "INSTANT", and where the line sits:
 *   - The LEAD clip is warmed with `preload="auto"` — real buffered video. Metadata
 *     alone was not enough: the click still began a cold fetch and the visitor sat
 *     watching the poster ("the reels don't play instant, it just shows like an
 *     image"). Sources are faststart (moov before mdat, verified), so buffered bytes
 *     play immediately.
 *   - Clips 2-4 warm to `preload="metadata"` only — headers, a few KB. They're a
 *     swipe away, and four full clips on the landing page is the bill that blew this
 *     project's egress cap once already.
 *   - Open: the active clip and the NEXT one buffer (`auto`) so a swipe lands on
 *     video, not a poster. Everything past the warm window is `none`, so a long deck
 *     never becomes a long download.
 *   - Warming waits for idle and is skipped on Save-Data / slower-than-4g, so it can
 *     never compete with the hero's LCP or spend a stranger's data uninvited.
 *   - Audio is ON, because the deck only ever opens from a tap — that gesture is
 *     exactly what autoplay policy requires. A mute control is always visible.
 */
export function PhoneReels({ reels }: { reels: MockReel[] }) {
  const [open, setOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [active, setActive] = useState(0);
  // Sound is ON once the deck is opened by a tap. That tap is a user gesture, which
  // is what browser autoplay policy requires for audible playback — the deck can be
  // audible precisely because it is never opened without one. If a later clip is
  // still refused (Safari is stricter per-element), we fall back to muted rather
  // than leaving a silent, frozen video.
  const [muted, setMuted] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const viewed = useRef<Set<string>>(new Set());

  // Warm strictly AFTER the load event, then on idle.
  //
  // Idle alone was not enough and it measurably cost us: on a throttled mobile link
  // requestIdleCallback fires while the page is still fetching, so four video
  // preloads went out competing with the <h1>'s own resources and LCP regressed
  // 2004ms -> 2304ms — straight through the 2s budget. `load` means the critical
  // resources are already done, so the warm-up can only ever use leftover bandwidth.
  // Idle covers the CPU; load covers the network. Both are required.
  useEffect(() => {
    if (!shouldWarm()) return;
    let cancelled = false;
    let idleId = 0;
    let timerId = 0;
    const start = () => {
      if (!cancelled) setWarm(true);
    };
    const afterLoad = () => {
      if (cancelled) return;
      // requestIdleCallback is unsupported on Safari <16.4 — fall back to a timeout.
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(start);
      else timerId = window.setTimeout(start, 1200);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", afterLoad);
      if (idleId) window.cancelIdleCallback(idleId);
      if (timerId) window.clearTimeout(timerId);
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
            v.play()
              .then(() => countView(reels[i]!.id))
              .catch(() => {
                // Refused audible autoplay — retry muted so the clip still plays.
                setMuted(true);
                v.muted = true;
                v.play().then(() => countView(reels[i]!.id)).catch(() => {});
              });
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
      {/* Closed state — the row the visitor sees BEFORE tapping. Polished: a
          duration-style pill, a live "Now playing"-ish cue on the lead, a soft ring
          so the tiles read as cards rather than flat crops, and the queued clip
          showing it's next. All paint, no extra bytes. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMuted(false);
            // Kick playback off INSIDE the gesture. Waiting for the effect/IO to do
            // it puts play() in a later task, where the browser no longer counts it
            // as user-initiated and refuses audio. The element is already mounted
            // (the deck renders on the same commit), so a rAF is enough to have the
            // ref, and we're still within the gesture's grace window.
            requestAnimationFrame(() => {
              const v = videoRefs.current[0];
              if (!v) return;
              v.muted = false;
              v.play().catch(() => {
                setMuted(true);
                v.muted = true;
                void v.play().catch(() => {});
              });
            });
          }}
          aria-label="Play trending reels"
          className="group/reel relative h-28 flex-1 overflow-hidden rounded-xl bg-neutral-800 ring-1 ring-inset ring-white/10"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lead.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/reel:scale-[1.06]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/25" />

          {/* LIVE cue — a real signal that this is playable video, not a photo. */}
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-[3px] text-[8px] font-bold uppercase tracking-wide text-white backdrop-blur">
            <span className="h-1 w-1 rounded-full bg-rose-400 motion-safe:animate-pulse" /> Reels
          </span>

          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur">
            <Play className="h-2.5 w-2.5" /> {compact(lead.viewsCount)} views
          </span>

          {/* Play affordance — grows on hover so it reads as a control. */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 ring-1 ring-white/40 backdrop-blur transition-transform duration-300 group-hover/reel:scale-110">
              <Play className="ml-[1px] h-4 w-4 fill-white text-white" />
            </span>
          </span>
        </button>

        {/* Up-next tile — labelled, so the row reads as a queue rather than a stray crop. */}
        <div className="relative h-28 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-800 ring-1 ring-inset ring-white/10">
          {second ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={second.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <span className="absolute inset-x-0 bottom-1 text-center text-[7px] font-semibold uppercase tracking-wide text-white/80">
                Next
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Warm-up, rendered only once idle + on a connection that can afford it.
          The LEAD clip gets `preload="auto"` — actual buffered video, which is the
          only thing that makes play truly instant. `preload="metadata"` (what this
          did before) fetches headers ONLY, so the click still started a cold fetch
          and the visitor sat looking at the poster: the owner's "the reels don't
          play instant, it just shows like an image". Clips 2-4 stay on metadata —
          they're a scroll away, and 4 full clips on the landing page is exactly the
          bill that blew the egress cap once. Verified: sources are faststart
          (moov before mdat), so buffered bytes start playing immediately. */}
      {warm && !open
        ? reels.slice(0, WARM_COUNT).map((r, i) => (
            <video
              key={`warm-${r.id}`}
              src={r.mediaUrl}
              preload={i === 0 ? "auto" : "metadata"}
              muted
              playsInline
              aria-hidden
              tabIndex={-1}
              // NOT `hidden`/`display:none` — a display:none <video> is not loaded at
              // all (measured: preload="auto" still gave readyState 0, buffered 0, so
              // the warm-up was silently doing nothing). It has to stay in the layout
              // to load, so: 1px, transparent, out of flow, uninteractive.
              className="pointer-events-none absolute h-px w-px opacity-0"
            />
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
          {/* Audio is on by default here (the deck is only ever opened by a tap), so
              a visible mute control is mandatory — sound the visitor can't stop is
              the single most hostile thing a landing page can do. */}
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              const v = videoRefs.current[active];
              if (v) {
                v.muted = next;
                if (!next) void v.play().catch(() => {});
              }
            }}
            aria-label={muted ? "Unmute reels" : "Mute reels"}
            aria-pressed={muted}
            className="absolute left-2 top-8 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
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
                  // Buffer the active clip AND the next one — that's how a swipe up
                  // lands on video rather than a poster (TikTok's model: fetch ahead
                  // by one while watching). Everything past the warm window is
                  // "none", so a long deck never becomes a long download.
                  preload={i === active || i === active + 1 ? "auto" : i < WARM_COUNT ? "metadata" : "none"}
                  muted={muted}
                  loop
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

                {/* Action rail — mirrors the real deck's right-hand column */}
                <span className="pointer-events-none absolute bottom-16 right-1.5 flex flex-col items-center gap-2.5 text-white drop-shadow">
                  <span className="flex flex-col items-center gap-0.5">
                    <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                    <span className="text-[7px] font-semibold">{compact(r.likesCount)}</span>
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-[7px] font-semibold">{compact(Math.round(r.likesCount / 9))}</span>
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
