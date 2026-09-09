"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BEFORE / AFTER, ACROSS THE WHOLE CLIP — the roll
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: the AI history should "have a full understandable before
 * and after roll."
 *
 * ── 🔴 WHY ONE FRAME WAS NOT ENOUGH ─────────────────────────────────────────
 *
 * `FrenzAICompare` samples a single moment a quarter of the way in, and for the
 * screen where a video has JUST been made that is the right answer: one frame,
 * one drag, proof.
 *
 * It is the wrong answer for history, and the same week proved it. A caption
 * that appears at 0:04 and a burned-in subtitle that appears at 0:11 are
 * different pieces of text with different outcomes — the overlay came out
 * cleanly and the subtitle was never detected at all. A comparison anchored to
 * one timestamp reports whichever of those two happened to be on screen, and
 * calls it the result. Somebody looking at it either sees a triumph or sees
 * nothing changed, and neither is what the tool did.
 *
 * So this samples FIVE moments spread across the clip and lets you step through
 * them. That is what makes the comparison understandable: you can see where the
 * text was removed, and — just as importantly — where it was not.
 *
 * ── 🔴 STILL NOT TWO PLAYING VIDEOS ─────────────────────────────────────────
 *
 * The battery rule this project holds everywhere is that one video decodes at a
 * time, and two synchronised decoders kept in step through every drag and seek
 * is both the heaviest thing on a page and the most fragile. Nothing about
 * wanting five moments changes that.
 *
 * Each file is opened ONCE, seeked through the five points in order, and each
 * frame is drawn into a small offscreen canvas. Then both video elements are
 * released. From that moment there is no decoder alive: switching moments is a
 * `drawImage` between two canvases, and dragging the divider is a `clip-path`
 * on an already-painted layer — a compositor operation with no repaint at all.
 *
 * ── 🔴 THE MEMORY CEILING IS THE WHOLE REASON FOR `MAX_EDGE` ────────────────
 *
 * Ten frames at a 720x1280 source would be 10 × 3.7 MB of canvas backing store,
 * which is not a thing to do on a phone for a panel inside a sheet. Capped at
 * 540 on the long edge each frame is ~0.6 MB, so the whole roll is under 6 MB —
 * and 540 is still more resolution than a comparison rendered at 44vh can show.
 *
 * ── Progressive, because five seeks are not instant ─────────────────────────
 *
 * A moment becomes available the instant BOTH sides of it have been drawn, and
 * the panel appears as soon as the first one does. Waiting for all five before
 * showing anything would turn a comparison into a loading screen.
 */

/**
 * Where to sample, as fractions of the clip.
 *
 * 🔴 Not 0 and not 1. The first frame of a social video is very often black, a
 * fade or a logo card, and the last is often a fade-out — moments that show
 * nothing about what the tool did. The interior five are spread evenly enough
 * to catch text that appears once and text that is on screen throughout.
 */
const MOMENTS = [0.12, 0.31, 0.5, 0.69, 0.88] as const;

/** The long edge of a captured frame. See the memory note above. */
const MAX_EDGE = 540;

/** Per-seek ceiling. A stalled seek must never hold the whole roll open. */
const SEEK_TIMEOUT_MS = 8_000;

type Phase = "loading" | "ready" | "unavailable";

type Pair = { before: HTMLCanvasElement | null; after: HTMLCanvasElement | null };

export function FrenzAICompareRoll({
  beforeUrl,
  afterUrl,
  className,
}: {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [moment, setMoment] = useState(0);
  /** Which moments have BOTH sides drawn. The strip and the phase read this. */
  const [ready, setReady] = useState<readonly boolean[]>(() => MOMENTS.map(() => false));
  /** Seconds per moment, filled in once a duration is known. */
  const [times, setTimes] = useState<readonly (number | null)[]>(() => MOMENTS.map(() => null));

  const pairs = useRef<Pair[]>(MOMENTS.map(() => ({ before: null, after: null })));
  const beforeCanvas = useRef<HTMLCanvasElement | null>(null);
  const afterCanvas = useRef<HTMLCanvasElement | null>(null);
  const stripRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const frame = useRef<HTMLDivElement | null>(null);

  /* ── the capture ────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;

    // Reset for a new pair of urls — a sheet reopened on a different job must
    // not show one frame of the previous one.
    pairs.current = MOMENTS.map(() => ({ before: null, after: null }));
    setReady(MOMENTS.map(() => false));
    setTimes(MOMENTS.map(() => null));
    setMoment(0);
    setPhase("loading");

    /**
     * Open one file, walk the five moments, hand each frame back.
     *
     * ── 🔴 NO `crossOrigin`, AND THAT IS DELIBERATE ───────────────────────
     *
     * Setting `crossOrigin = "anonymous"` does not merely REQUEST cors — it
     * makes the browser refuse to load the media at all unless the response
     * carries a matching `Access-Control-Allow-Origin`. These are Supabase
     * signed URLs on another origin, so it killed the original comparison
     * outright (owner, 2026-09-08: "the before and after button doesnt show
     * anything").
     *
     * It was never needed. Drawing a cross-origin video into a canvas is
     * allowed; it only TAINTS the canvas, which blocks reading it back —
     * `getImageData`, `toDataURL`, `toBlob`. Nothing here does any of those.
     * That is also why the strip below is a row of canvases rather than a row
     * of `<img>`: there is no way to turn a tainted frame into a data url, so
     * each thumbnail is drawn rather than exported.
     */
    const walk = (url: string, onFrame: (i: number, canvas: HTMLCanvasElement) => void) =>
      new Promise<void>((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;

        let index = 0;
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const release = () => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          // Released the moment the walk ends: a detached element still holding
          // a decoded buffer is exactly the memory this approach avoids.
          video.removeAttribute("src");
          video.load();
          resolve();
        };

        const seekNext = () => {
          if (!alive || index >= MOMENTS.length) return release();
          const duration = video.duration;
          const usable = Number.isFinite(duration) && duration > 0 ? duration : 0;
          /*
            A clip with no readable duration collapses to a single frame at 0
            rather than failing: one moment is a worse roll than five and a far
            better one than an empty panel.
          */
          if (usable === 0 && index > 0) return release();
          const at = usable * MOMENTS[index]!;
          if (timer) clearTimeout(timer);
          timer = setTimeout(release, SEEK_TIMEOUT_MS);
          video.currentTime = at;
        };

        video.onloadedmetadata = () => {
          const duration = video.duration;
          if (Number.isFinite(duration) && duration > 0) {
            // Written once by whichever file loads first; both are the same
            // length by construction (the finalizer validates it), so the
            // second write is the same values.
            setTimes(MOMENTS.map((f) => duration * f));
          }
          seekNext();
        };

        video.onseeked = () => {
          if (!alive) return release();
          const i = index;
          try {
            const w = video.videoWidth || 0;
            const h = video.videoHeight || 0;
            if (w === 0 || h === 0) return release();
            const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
            const canvas = document.createElement("canvas");
            // Even dimensions, so a later `drawImage` into the visible canvas
            // never lands on a half pixel.
            canvas.width = Math.max(2, Math.round((w * scale) / 2) * 2);
            canvas.height = Math.max(2, Math.round((h * scale) / 2) * 2);
            const ctx = canvas.getContext("2d");
            if (!ctx) return release();
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            onFrame(i, canvas);
          } catch {
            // A draw that throws ends the walk rather than spinning through
            // four more seeks that will throw identically.
            return release();
          }
          index += 1;
          seekNext();
        };

        video.onerror = release;
        video.src = url;
      });

    const mark = (i: number) => {
      const pair = pairs.current[i];
      if (!pair?.before || !pair.after) return;
      setReady((prev) => {
        if (prev[i]) return prev;
        const next = prev.slice();
        next[i] = true;
        return next;
      });
      setPhase("ready");
    };

    void (async () => {
      await Promise.all([
        walk(beforeUrl, (i, canvas) => {
          const pair = pairs.current[i];
          if (pair) pair.before = canvas;
          mark(i);
        }),
        walk(afterUrl, (i, canvas) => {
          const pair = pairs.current[i];
          if (pair) pair.after = canvas;
          mark(i);
        }),
      ]);
      if (!alive) return;
      // Only now can "nothing worked" be distinguished from "still working".
      setPhase((p) => (p === "ready" ? p : "unavailable"));
    })();

    return () => {
      alive = false;
      /*
        🔴 Drop the backing stores on the way out. A canvas is only collected
        once nothing references it, and this sheet can be opened on job after
        job — five megabytes left behind each time is a phone that gets slower
        the longer somebody browses their own history.
      */
      pairs.current = MOMENTS.map(() => ({ before: null, after: null }));
    };
  }, [beforeUrl, afterUrl]);

  /* ── painting the chosen moment ─────────────────────────────────────────── */

  /** Copy one stored frame into a visible canvas at its own size. */
  const paint = useCallback((dst: HTMLCanvasElement | null, src: HTMLCanvasElement | null) => {
    if (!dst || !src) return;
    if (dst.width !== src.width || dst.height !== src.height) {
      dst.width = src.width;
      dst.height = src.height;
    }
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0);
  }, []);

  useEffect(() => {
    const pair = pairs.current[moment];
    paint(beforeCanvas.current, pair?.before ?? null);
    paint(afterCanvas.current, pair?.after ?? null);
  }, [moment, ready, paint]);

  /* The strip: the AFTER frame of each moment, small. Drawn rather than
     exported, because a tainted canvas cannot be turned into an image. */
  useEffect(() => {
    ready.forEach((isReady, i) => {
      if (!isReady) return;
      const dst = stripRefs.current[i];
      const src = pairs.current[i]?.after;
      if (!dst || !src) return;
      const scale = Math.min(1, 128 / Math.max(src.width, src.height));
      const w = Math.max(2, Math.round(src.width * scale));
      const h = Math.max(2, Math.round(src.height * scale));
      if (dst.width !== w || dst.height !== h) {
        dst.width = w;
        dst.height = h;
      }
      dst.getContext("2d")?.drawImage(src, 0, 0, w, h);
    });
  }, [ready]);

  /* ── the drag ───────────────────────────────────────────────────────────── */
  const moveTo = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPosition(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => moveTo(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, moveTo]);

  const availableCount = ready.filter(Boolean).length;

  if (phase === "unavailable") {
    /*
      Said plainly rather than hidden. The original is the first thing the
      retention sweep removes, so "there is nothing left to compare against" is
      an ordinary outcome on an older job — and a panel that simply vanished
      would read as the button being broken.
    */
    return (
      <p className={cn("rounded-2xl bg-secondary px-4 py-6 text-center text-xs text-muted-foreground", className)}>
        The original isn&apos;t available to compare against any more.
      </p>
    );
  }

  if (phase === "loading") {
    return (
      <div
        className={cn("aspect-square w-full animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none", className)}
        aria-label="Preparing the comparison"
      />
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={frame}
        className="relative select-none touch-none overflow-hidden rounded-2xl bg-black/90"
        onPointerDown={(e) => {
          setDragging(true);
          moveTo(e.clientX);
        }}
      >
        {/* AFTER underneath, full width. */}
        <canvas ref={afterCanvas} className="mx-auto block h-auto max-h-[42vh] w-auto max-w-full" />

        {/*
          BEFORE on top, clipped to the divider. `clip-path` on an already
          painted layer is a compositor operation — no repaint, no layout, so
          the drag stays smooth while a finger is moving.
        */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} aria-hidden>
          <canvas ref={beforeCanvas} className="block h-auto max-h-[42vh] w-auto max-w-full" />
        </div>

        {/* The luminous divider. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px"
          style={{
            left: `${position}%`,
            background: "linear-gradient(to bottom, transparent, hsl(var(--brand-blue-accent)), transparent)",
            boxShadow: "0 0 12px 1px hsl(var(--brand-blue) / 0.8)",
          }}
        >
          <span
            className={cn(
              "absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
              "bg-white/95 shadow-lg ring-1 ring-black/10 transition-transform duration-150 motion-reduce:transition-none",
              dragging && "scale-110",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-800" aria-hidden>
              <path d="M9 6 4 12l5 6M15 6l5 6-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">
          Before
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">
          After
        </span>
      </div>

      {/*
        The real control. Visually a thin track under the frame, but it is what
        keyboard and assistive technology actually operate — the drag above sets
        the same value. That is why there is no `role="slider"` anywhere here:
        there IS a slider here.
      */}
      <label className="mt-3 block">
        <span className="sr-only">Reveal the original video</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(position)}
          onChange={(e) => setPosition(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          aria-valuetext={`${Math.round(position)}% original`}
        />
      </label>

      {/* ── the roll ─────────────────────────────────────────────────────── */}
      {availableCount > 1 ? (
        <>
          <div
            role="tablist"
            aria-label="Moments in this video"
            className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1"
          >
            {MOMENTS.map((_, i) => {
              const isReady = ready[i] === true;
              const selected = moment === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  // A moment nobody could capture is not a control. Disabled
                  // rather than hidden, so the strip does not reflow as frames
                  // arrive one after another.
                  disabled={!isReady}
                  onClick={() => setMoment(i)}
                  className={cn(
                    "relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-secondary transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100",
                    !isReady && "animate-pulse motion-reduce:animate-none",
                  )}
                >
                  <canvas
                    ref={(el) => {
                      stripRefs.current[i] = el;
                    }}
                    className="h-full w-full object-cover"
                    style={{ objectFit: "cover" }}
                  />
                  {times[i] !== null && isReady ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9px] font-bold tabular-nums text-white">
                      {clock(times[i]!)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-center text-[11px] leading-snug text-muted-foreground">
            Drag to reveal the original. Tap a moment to check another part of the video.
          </p>
        </>
      ) : (
        <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
          Drag to reveal the original.
        </p>
      )}
    </div>
  );
}

/** `m:ss`. Local to this file: nothing else needs a clock this small. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
