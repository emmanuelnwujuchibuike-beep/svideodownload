"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

const PULL_THRESHOLD = 72;

/**
 * Reusable "slide down from the top to refresh" gesture, extracted from the
 * Home feed's original implementation (same premium visual — a quiet,
 * grayscale, rotating F, never a colorful spinner) so any page can drop it in
 * with its own `onRefresh`. Purely additive: never calls `preventDefault`, so
 * native vertical scrolling is untouched — `touchAction: pan-y` is enough to
 * keep it from ever fighting a horizontal gesture nested inside.
 *
 * Home's own `SmartFeed` keeps its hand-rolled version rather than switching
 * to this — it interleaves the same touch stream with horizontal tab-swipe
 * detection, and refactoring an already-shipped, delicate combined gesture
 * handler carried more regression risk than the duplication was worth.
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const y = t?.clientY;
    if (y !== undefined && window.scrollY <= 0 && !refreshing) pullStart.current = y;
    else pullStart.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const y = t?.clientY;
    if (pullStart.current !== null && y !== undefined) {
      const delta = y - pullStart.current;
      if (delta > 0 && window.scrollY <= 0) setPull(Math.min(110, delta * 0.5));
      else if (pull !== 0) setPull(0);
    }
  };
  const onTouchEnd = async () => {
    if (pullStart.current === null) return;
    pullStart.current = null;
    if (pull >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      haptic("selection");
      await onRefresh();
      setRefreshing(false);
    }
    setPull(0);
  };

  /*
    🔴 A pull the system took away (owner, 2026-10-29: after leaving the app and coming back, "much gap between the top
    nav and the feed card"). Swiping up to the home screen, a call or a notification CANCELS the touch: no touchend ever
    comes, so the pull spacer (up to 110 px) stayed open above the content. A cancelled touch, or the page going to the
    background, drops the pull.
  */
  const cancelPull = () => {
    pullStart.current = null;
    if (!refreshing) setPull(0);
  };
  useEffect(() => {
    // a refresh in flight holds its spinner at the threshold — that one ends on its own
    const drop = () => {
      pullStart.current = null;
      setPull((p) => (p === PULL_THRESHOLD ? p : 0));
    };
    const onVisibility = () => document.visibilityState === "hidden" && drop();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", drop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", drop);
    };
  }, []);

  const pullProgress = Math.min(1, pull / PULL_THRESHOLD);

  return (
    <div
      className={cn("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={cancelPull}
      style={{ touchAction: "pan-y" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center overflow-hidden"
        style={{ height: pull, opacity: pull > 4 ? 1 : 0 }}
      >
        <div className="relative flex items-center justify-center" style={{ transform: `translateY(${pull - 40}px)` }}>
          <span
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full bg-secondary/60 ring-1 ring-border/50 backdrop-blur",
              refreshing && "motion-safe:animate-pulse",
            )}
            style={{ transform: `rotate(${pull * 2}deg)` }}
          >
            <span className="block [filter:grayscale(1)]" style={{ opacity: 0.3 + pullProgress * 0.45 }}>
              <FrenzLogo size={18} />
            </span>
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
