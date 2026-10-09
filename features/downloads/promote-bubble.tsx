"use client";

import { Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * "Promote on Frenzsave" as a small round button (owner, 2026-10-09: "let this
 * promote card float and stick by the side in round without blocking the view and
 * at the same time show it is for promotion, and it should also lazy load. It
 * should be able to be dragged and moved to anywhere by the side of the screen").
 *
 * Refined to the improved reference (owner, 2026-10-09: "Ad button: less
 * intrusive, smaller size, no overlap, neutral badge"):
 *
 *   · 40 px, a white disc with a violet megaphone and a quiet grey "Ad" tag —
 *     still plainly a promotion, no longer the loudest thing on the page.
 *   · DOCKED by default. A page that wants it inline renders an empty
 *     `#frenz-promote-dock` slot (the download page puts one beside the credits
 *     card, exactly where the reference draws it). Docked, the button sits in
 *     normal flow and scrolls with the page — it can never float over the paste
 *     box or the Save button, and it costs no scroll listener.
 *   · Drag it anywhere and it floats at the nearer side, kept clear of the header,
 *     the bottom nav and the home indicator; its place is remembered on this
 *     device. Dropped back on its dock, it docks again.
 *   · A drag is never a tap: moving more than 6 px cancels the click.
 *   · Loaded by PromoteBubbleLazy only after the page is idle — never in first
 *     paint. No animation runs at rest.
 */
const SIZE = 40;
const EDGE = 8;
const KEY = "frenz:promote-bubble:v1";
const DOCK_ID = "frenz-promote-dock";

type Spot = { side: "left" | "right"; y: number };

function navHeight(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomnav-h")) || 0;
}

function clampY(y: number): number {
  // Under the fixed header (its real bottom, so the safe-area top is included).
  const header = document.querySelector("header");
  const top = Math.max(84, (header?.getBoundingClientRect().bottom ?? 0) + 12);
  const bottom = window.innerHeight - navHeight() - SIZE - 16;
  return Math.max(top, Math.min(bottom, y));
}

function readSpot(): Spot | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Spot | null;
    if (s && (s.side === "left" || s.side === "right") && Number.isFinite(s.y)) return s;
  } catch {
    /* no saved spot */
  }
  return null;
}

function saveSpot(s: Spot | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* the spot is just not remembered */
  }
}

export function PromoteBubble() {
  const router = useRouter();
  const [dock, setDock] = useState<HTMLElement | null>(null);
  // null until mounted; "dock" while it sits in its slot; a Spot while floating.
  const [spot, setSpot] = useState<Spot | "dock" | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const el = document.getElementById(DOCK_ID);
    setDock(el);
    const saved = readSpot();
    setSpot(saved ? { ...saved, y: clampY(saved.y) } : el ? "dock" : { side: "right", y: clampY(window.innerHeight - navHeight() - SIZE - 24) });
    const onResize = () => setSpot((s) => (s && s !== "dock" ? { ...s, y: clampY(s.y) } : s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /*
    The drag listens on WINDOW, not on the button, because a drag that starts on
    the docked button continues on the floating one: the docked copy stays mounted
    (hidden) until the gesture ends, and window listeners are what survive that.
    `touch-action: none` on the button stops the page panning under the finger.
  */
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const s = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top, moved: false, last: { x: rect.left, y: rect.top } };
    router.prefetch("/advertise");
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - s.px;
      const dy = ev.clientY - s.py;
      if (!s.moved && Math.hypot(dx, dy) < 6) return;
      s.moved = true;
      s.last = { x: Math.max(EDGE, Math.min(window.innerWidth - SIZE - EDGE, s.x + dx)), y: s.y + dy };
      setDrag(s.last);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!s.moved) return;
      dragged.current = true;
      // A click may not follow (touch); never let the flag outlive this gesture.
      window.setTimeout(() => (dragged.current = false), 350);
      setDrag(null);
      if (ev.type === "pointercancel") return;
      haptic("selection");
      const dockRect = dock?.getBoundingClientRect();
      if (dockRect && Math.hypot(s.last.x - dockRect.left, s.last.y - dockRect.top) < 56) {
        setSpot("dock");
        saveSpot(null);
        return;
      }
      const next: Spot = { side: s.last.x + SIZE / 2 < window.innerWidth / 2 ? "left" : "right", y: clampY(s.last.y) };
      setSpot(next);
      saveSpot(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (pending) return;
    haptic("light");
    setPending(true);
    window.setTimeout(() => setPending(false), 4000);
    router.push("/advertise");
  };

  if (!spot) return null;

  const button = (floating: boolean, style?: CSSProperties) => (
    <button
      type="button"
      aria-label="Promote on Frenzsave (advertising)"
      title="Promote on Frenzsave"
      data-track="advertise_clicked"
      data-pending={pending ? "" : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{ width: SIZE, height: SIZE, touchAction: "none", ...style }}
      className={cn(
        "flex items-center justify-center rounded-full bg-white text-violet-600 shadow-[0_4px_12px_-6px_rgb(15_23_42/0.35)] ring-1 ring-inset ring-slate-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95 data-[pending]:opacity-70",
        "dark:bg-slate-900 dark:text-violet-300 dark:ring-white/15",
        floating ? "fixed left-0 top-0 z-[35]" : "relative",
        floating && !drag && "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
      )}
    >
      <Megaphone className="h-[18px] w-[18px]" aria-hidden />
      <span
        aria-hidden
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-slate-100 px-1 py-px text-[8px] font-bold uppercase leading-none tracking-wide text-slate-500 ring-1 ring-white dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-900"
      >
        Ad
      </span>
    </button>
  );

  const docked = spot === "dock" && dock;
  const floatAt = drag ?? (spot !== "dock" ? { x: spot.side === "right" ? window.innerWidth - SIZE - EDGE : EDGE, y: spot.y } : null);

  return (
    <>
      {docked ? createPortal(<span className={drag ? "invisible" : undefined}>{button(false)}</span>, dock) : null}
      {floatAt ? createPortal(button(true, { transform: `translate3d(${floatAt.x}px, ${floatAt.y}px, 0)` }), document.body) : null}
    </>
  );
}
