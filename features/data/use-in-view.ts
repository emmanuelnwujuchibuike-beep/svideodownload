"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Observe when a sentinel element scrolls into view — the trigger for prefetching
 * the next page of an infinite list before the user reaches the end (so new
 * content is already there, never a spinner at the bottom).
 *
 *   const { ref, inView } = useInView({ rootMargin: "600px" });
 *   useEffect(() => { if (inView) feed.loadMore(); }, [inView]);
 *   return <>{items.map(...)}<div ref={ref} /></>;
 *
 * `rootMargin: "600px"` means "fire ~600px before the sentinel is visible", which
 * is what makes the scroll feel seamless.
 */
export function useInView<T extends Element = HTMLDivElement>(
  options: { rootMargin?: string; threshold?: number; enabled?: boolean } = {},
) {
  const { rootMargin = "600px", threshold = 0, enabled = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold, enabled]);

  return { ref, inView };
}
