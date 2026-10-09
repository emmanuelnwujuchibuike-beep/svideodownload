"use client";

import { Loader2, Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { haptic } from "@/lib/motion/haptics";

/**
 * "Promote on Frenzsave" as a floating side bubble (owner, 2026-10-09: "let this
 * promote card float and stick by the side in round without blocking the view and
 * at the same time show it is for promotion, and it should also lazy load. It
 * should be able to be dragged and moved to anywhere by the side of the screen").
 *
 *   · A 48 px round button that hugs the screen edge, with a small "Promote" tag so it
 *     always reads as a promotion. It covers nothing it cannot be dragged off.
 *   · Drag it anywhere. On release it snaps to the nearer side, kept clear of the
 *     header and the bottom nav. Its place is remembered on this device.
 *   · A drag is never a tap: moving more than 6 px cancels the click.
 *   · Loaded by PromoteBubbleLazy only after the page is idle — never in first paint.
 */
const SIZE = 48;
const EDGE = 8;
const KEY = "frenz:promote-bubble:v1";

type Spot = { side: "left" | "right"; y: number };

function clampY(y: number): number {
  const top = 84; // under the fixed header
  const navH = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomnav-h")) || 0;
  const bottom = window.innerHeight - navH - SIZE - 16;
  return Math.max(top, Math.min(bottom, y));
}

function readSpot(): Spot {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Spot | null;
    if (s && (s.side === "left" || s.side === "right") && Number.isFinite(s.y)) return s;
  } catch {
    /* default */
  }
  return { side: "right", y: Math.round(window.innerHeight * 0.58) };
}

export function PromoteBubble() {
  const router = useRouter();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  // A tap is handled on pointer-up; the click that follows it must not run it twice.
  const tapped = useRef(false);

  /*
    🔴 THE FIRST TAP MUST VISIBLY RESPOND (owner, 2026-10-09: "the promote button
    doesn't respond tap instant on first tap, it suppose to respond and spin").
    The press feedback was `active:scale-95` on the button — but the button's
    inline `transform` (its position) overrides any transform class, so nothing
    moved. It now scales an INNER layer, swaps the megaphone for a spinner at
    once, navigates on pointer-up rather than waiting for the click, and the
    route is prefetched as soon as the bubble is on screen.
  */
  const go = () => {
    if (pending) return;
    haptic("light");
    setPending(true);
    window.setTimeout(() => setPending(false), 4000);
    router.push("/advertise");
  };

  useEffect(() => {
    router.prefetch("/advertise");
  }, [router]);

  useEffect(() => {
    setSpot((s) => s ?? { ...readSpot(), y: clampY(readSpot().y) });
    const onResize = () => setSpot((s) => (s ? { ...s, y: clampY(s.y) } : s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!spot) return null;
  const restX = spot.side === "right" ? window.innerWidth - SIZE - EDGE : EDGE;
  const x = drag?.x ?? restX;
  const y = drag?.y ?? spot.y;

  return (
    <Portal>
      <button
        type="button"
        aria-label="Promote on Frenzsave (advertising)"
        data-track="advertise_clicked"
        data-pending={pending ? "" : undefined}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { px: e.clientX, py: e.clientY, x, y, moved: false };
          router.prefetch("/advertise");
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.px;
          const dy = e.clientY - s.py;
          if (!s.moved && Math.hypot(dx, dy) < 6) return;
          s.moved = true;
          setDrag({ x: Math.max(EDGE, Math.min(window.innerWidth - SIZE - EDGE, s.x + dx)), y: s.y + dy });
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          if (!s.moved) {
            tapped.current = true;
            go();
            return;
          }
          const cx = (drag?.x ?? x) + SIZE / 2;
          const next: Spot = { side: cx < window.innerWidth / 2 ? "left" : "right", y: clampY(drag?.y ?? y) };
          setDrag(null);
          setSpot(next);
          haptic("selection");
          try {
            localStorage.setItem(KEY, JSON.stringify(next));
          } catch {
            /* the spot is just not remembered */
          }
          // the click that follows a drag must not navigate
          (e.currentTarget as HTMLElement).dataset.dragged = "1";
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
        onClick={(e) => {
          const el = e.currentTarget as HTMLElement;
          if (el.dataset.dragged) {
            delete el.dataset.dragged;
            return;
          }
          if (tapped.current) {
            tapped.current = false; // already handled on pointer-up
            return;
          }
          go(); // keyboard (Enter / Space)
        }}
        style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: SIZE, height: SIZE, touchAction: "none" }}
        aria-busy={pending || undefined}
        className={`group fixed left-0 top-0 z-[35] flex items-center justify-center rounded-full motion-reduce:transition-none ${drag ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"}`}
      >
        {/* The visible disc. Scaled here, never on the button, whose inline transform is its position. */}
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_10px_24px_-10px_rgb(79_70_229/0.8)] ring-2 ring-white/80 transition-transform duration-100 group-active:scale-90 group-data-[pending]:scale-95 dark:ring-white/20 motion-reduce:transition-none">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Megaphone className="h-5 w-5" aria-hidden />}
        </span>
        {/* owner 2026-10-09: the tag reads "Promote", not "Ad" */}
        <span aria-hidden className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-1.5 py-px text-[8.5px] font-extrabold uppercase leading-none tracking-wide text-amber-950 shadow-sm">
          Promote
        </span>
      </button>
    </Portal>
  );
}
