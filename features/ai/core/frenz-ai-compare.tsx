"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BEFORE / AFTER — the tool proving its own claim
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: a premium before/after for editing tools such as the
 * caption remover — draggable, tappable, with a luminous divider rather than a
 * generic comparison widget.
 *
 * ── 🔴 IT COMPARES TWO FRAMES, NOT TWO VIDEOS ────────────────────────────────
 *
 * The obvious build is two `<video>` elements side by side with one clipped.
 * It is also the one that breaks phones: this project's battery rule is
 * explicit that only ONE video decodes at a time, and two synchronised
 * decoders — kept in step through every drag, seek and stall — is both the
 * heaviest thing on the page and the most fragile.
 *
 * So each video is decoded EXACTLY ONCE. Both are seeked to the same timestamp,
 * that single frame is drawn into a canvas, and the video elements are then
 * released. From that moment the comparison is two bitmaps: dragging is pure
 * compositing, it stays smooth on a mid-range Android, and nothing is decoding
 * while somebody plays with the slider.
 *
 * It is also the more honest comparison. A frame at the same timestamp, from
 * both files, is the actual evidence of what the model removed — where a pair
 * of playing videos drifting a few frames apart would show a difference that
 * has nothing to do with the tool.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────
 *
 * A real `<input type="range">` under the surface, not a div with pointer
 * handlers. It is focusable, arrow keys move it, a screen reader announces it,
 * and the drag gesture is the same control by another route. That is why there
 * is no `role="slider"` here — there is a slider here.
 */

/** Where in the clip to sample. Not 0: the first frame is often black. */
const SAMPLE_FRACTION = 0.25;
const SEEK_TIMEOUT_MS = 8_000;

type Phase = "loading" | "ready" | "unavailable";

export function FrenzAICompare({
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
  const beforeCanvas = useRef<HTMLCanvasElement | null>(null);
  const afterCanvas = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  /* One decode each, then the video elements are gone. */
  useEffect(() => {
    let alive = true;

    const capture = (url: string, canvas: HTMLCanvasElement | null): Promise<boolean> =>
      new Promise((resolve) => {
        if (!canvas) return resolve(false);
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;

        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // Released immediately: a detached element still holding a decoded
          // buffer is exactly the memory this approach exists to avoid.
          video.removeAttribute("src");
          video.load();
          resolve(ok);
        };
        const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);

        video.onloadedmetadata = () => {
          const at = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * SAMPLE_FRACTION : 0;
          video.currentTime = at;
        };
        video.onseeked = () => {
          try {
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx = canvas.getContext("2d");
            if (!ctx) return done(false);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            done(true);
          } catch {
            // A tainted canvas (a signed URL without CORS headers) lands here.
            // Not an error worth showing anyone — the panel simply falls back
            // to the plain result player.
            done(false);
          }
        };
        video.onerror = () => done(false);
        video.src = url;
      });

    (async () => {
      const [a, b] = await Promise.all([
        capture(beforeUrl, beforeCanvas.current),
        capture(afterUrl, afterCanvas.current),
      ]);
      if (!alive) return;
      setPhase(a && b ? "ready" : "unavailable");
    })();

    return () => {
      alive = false;
    };
  }, [beforeUrl, afterUrl]);

  /* Dragging anywhere on the frame moves the divider. */
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

  return (
    <div className={cn("relative", phase !== "ready" && "hidden", className)}>
      <div
        ref={frame}
        className="relative overflow-hidden rounded-2xl bg-black/90 select-none touch-none"
        onPointerDown={(e) => {
          setDragging(true);
          moveTo(e.clientX);
        }}
      >
        {/* AFTER underneath, full width. */}
        <canvas ref={afterCanvas} className="block h-auto w-full" />

        {/*
          BEFORE on top, clipped to the divider. `clip-path` on an already
          painted layer is a compositor operation — no repaint, no layout, so
          the drag stays at 60fps while a finger is moving.
        */}
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          aria-hidden
        >
          <canvas ref={beforeCanvas} className="block h-auto w-full" />
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

        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90 backdrop-blur-sm">
          Before
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90 backdrop-blur-sm">
          After
        </span>
      </div>

      {/*
        The real control. Visually a thin track under the frame, but it is what
        keyboard and assistive technology actually operate — the drag above sets
        the same value.
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
    </div>
  );
}
