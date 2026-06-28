"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll-into-view reveal animation. Wrap any block to fade + rise it in once.
 *
 * Driven by IntersectionObserver + a CSS transition on `transform`/`opacity`
 * so the animation runs entirely on the compositor (GPU) thread — smooth on
 * every device, no main-thread jank. Respects `prefers-reduced-motion`.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Honor reduced-motion: reveal instantly, skip the transition entirely.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.01 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "motion-reduce:!translate-y-0 motion-reduce:!opacity-100 motion-reduce:!transition-none",
        "transform-gpu transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
      style={{
        transitionDelay: shown ? `${delay}s` : "0s",
        willChange: shown ? "auto" : "transform, opacity",
      }}
    >
      {children}
    </div>
  );
}
