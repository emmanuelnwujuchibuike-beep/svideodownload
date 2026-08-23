"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";

/**
 * The ONE premium glass bottom-sheet shell, shared by every sheet in the app
 * that wants Part 5/6's "floating glass panel" treatment — first built for
 * comments (replacing three independently forked wrappers with different
 * blur/height/z-index each), then reused as-is for the share sheet rather
 * than forking a near-identical second copy: nothing about the gesture or
 * chrome below is comment- or share-specific.
 *
 * Height is gesture-controlled with three detents (min/default/max, in vh),
 * dragged from the handle only — never the scrollable content below it, so
 * this never fights list/grid scrolling the way an armed-at-scroll-top drag
 * would. Below the min detent the drag converts to a damped dismiss
 * translate: same recipe already proven twice elsewhere in this codebase
 * (wallpaper reels, the image viewer's swipe-to-close) — `dy * 0.6` capped at
 * 260px, ~110px commit threshold, no transition while dragging so it tracks
 * the finger exactly, one on release so it springs back or snaps to a detent.
 */

const MIN_VH = 42;
const MAX_VH = 92;
const DISMISS_PX = 110;
const DAMPING = 0.6;
const DAMP_CAP = 260;

export function GlassSheetShell({
  open,
  onClose,
  title,
  headerExtra,
  /** Renders full-bleed over the ENTIRE sheet (header included) — e.g. a
   *  "Sent to N people" success state. Positioned relative to the panel, not
   *  the scrollable content area, so it never leaves the header peeking out. */
  overlay,
  onOpen,
  defaultHeightVh = 68,
  backdropZ = 95,
  panelZ = 96,
  /**
   * 🔴 Content-hugging height (owner, 2026-08-18 — comments sheet with a
   * single comment: "opens inside an overlay... is supposed to open above
   * very visible professionally and premium", i.e. not a fixed-size box
   * with a dead gap under a short list). When true, the sheet opens at
   * whatever height its ACTUAL content needs (measured via ResizeObserver,
   * so it re-fits as async data loads in or a comment is added), clamped
   * between MIN_VH and `defaultHeightVh` — so it never grows past what a
   * caller already considered a sensible ceiling, only shrinks BELOW it for
   * genuinely short content. The drag gesture is untouched: dragging still
   * works exactly as before and, once the visitor drags, their choice wins
   * over any further auto-fit for the rest of this open session.
   *
   * Off by default — every other consumer of this shared shell (image
   * viewer, reel viewer, the two share sheets) keeps its exact existing
   * fixed-`defaultHeightVh` behavior unless it explicitly opts in.
   */
  fitContent = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  headerExtra?: React.ReactNode;
  overlay?: React.ReactNode;
  /** Fires once each time the sheet opens — e.g. to lazily load content. */
  onOpen?: () => void;
  defaultHeightVh?: number;
  backdropZ?: number;
  panelZ?: number;
  fitContent?: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const detents = [MIN_VH, defaultHeightVh, MAX_VH];
  const [heightVh, setHeightVh] = useState(defaultHeightVh);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(defaultHeightVh);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const contentInnerRef = useRef<HTMLDivElement | null>(null);
  // Once the visitor drags, THEIR height wins for the rest of this open
  // session — auto-fit stops recomputing over it. Reset each time it opens.
  const userAdjustedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setHeightVh(defaultHeightVh);
      setDragY(0);
      userAdjustedRef.current = false;
      onOpen?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /*
   * fitContent's actual measurement. `contentInnerRef` wraps `children`
   * WITHOUT its own height constraint (only its scrollable ANCESTOR below
   * has one), so its rendered height is the content's true natural size —
   * `scrollHeight` on the ancestor itself would just report the ancestor's
   * own fixed height back whenever content is shorter than it (scrollHeight
   * is defined as at least clientHeight), which is exactly the measurement
   * that would fail to detect "this content is short, shrink the sheet".
   * A ResizeObserver (not a one-shot measurement) re-fits automatically as
   * comments load in async, a new comment is posted, or the keyboard opens.
   */
  useEffect(() => {
    if (!fitContent || !open) return;
    const el = contentInnerRef.current;
    if (!el) return;
    const recompute = () => {
      if (userAdjustedRef.current) return;
      const vh = window.innerHeight / 100;
      const headerPx = headerRef.current?.offsetHeight ?? 0;
      const neededVh = (headerPx + el.scrollHeight) / vh + 4; // + a little breathing room
      setHeightVh(Math.min(defaultHeightVh, Math.max(MIN_VH, neededVh)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [fitContent, open, defaultHeightVh]);

  // Escape closes (every sheet in this app supported this before the three
  // forked wrappers were consolidated into this shell — a real regression
  // to not carry forward), body scroll locks while open (previously handled
  // per-caller, inconsistently — now the shell's own job so every sheet
  // gets it), and focus moves into the panel so a keyboard/screen-reader
  // user isn't left on whatever was behind it. This is the minimum WAI-ARIA
  // dialog pattern (focus enters, Escape exits) — NOT a full focus trap
  // (Tab can still leave the dialog into the page behind it); that's a
  // real, larger addition left undone here rather than shipped half-right.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  const onGrabStart = (clientY: number) => {
    setDragging(true);
    userAdjustedRef.current = true;
    startY.current = clientY;
    startHeight.current = heightVh;
  };
  const onGrabMove = (clientY: number) => {
    const dy = clientY - startY.current; // positive = finger moved down
    const vh = window.innerHeight / 100;
    const deltaVh = dy / vh;
    const wanted = startHeight.current - deltaVh;
    if (wanted >= MIN_VH) {
      setHeightVh(Math.min(MAX_VH, wanted));
      setDragY(0);
    } else {
      setHeightVh(MIN_VH);
      const overflowPx = (MIN_VH - wanted) * vh;
      setDragY(Math.min(overflowPx * DAMPING, DAMP_CAP));
    }
  };
  const onGrabEnd = () => {
    setDragging(false);
    if (dragY > DISMISS_PX) {
      haptic("light");
      onClose();
      return;
    }
    setDragY(0);
    setHeightVh((h) => detents.reduce((best, d) => (Math.abs(d - h) < Math.abs(best - h) ? d : best), detents[0]!));
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Sheet"}>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
            style={{ zIndex: backdropZ }}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-2xl flex-col rounded-t-3xl border-t border-white/10 bg-card/95 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl outline-none"
            style={{
              zIndex: panelZ,
              height: `${heightVh}vh`,
              transform: dragY ? `translateY(${dragY}px)` : undefined,
              transition: dragging ? "none" : "transform 220ms var(--ease-out), height 260ms var(--ease-out)",
            }}
          >
            {overlay ? <div className="absolute inset-0 z-10">{overlay}</div> : null}
            <div
              ref={headerRef}
              className="shrink-0 touch-none px-5 pt-3"
              onTouchStart={(e) => onGrabStart(e.touches[0]?.clientY ?? 0)}
              onTouchMove={(e) => onGrabMove(e.touches[0]?.clientY ?? 0)}
              onTouchEnd={onGrabEnd}
              onTouchCancel={onGrabEnd}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">{title}</h3>
                <div className="flex items-center gap-1">
                  {headerExtra}
                  <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1">
              {/* Unconstrained wrapper — see fitContent's measurement note above
                  for why this can't just be scrollHeight on the scrollable
                  parent. A plain passthrough div when fitContent is off. */}
              <div ref={contentInnerRef}>{children}</div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
