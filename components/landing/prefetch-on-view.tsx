"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useInView } from "@/features/data";

/**
 * Warm a set of routes the moment this sentinel scrolls near, so the first tap in
 * the surrounding section opens instantly and — because Next caches the prefetch —
 * keeps opening instantly (owner: "warm up when scrolled almost to the section …
 * cache-first so it keeps opening instantly").
 *
 * A client sentinel usable inside a SERVER component (e.g. MeetNewPeople) which
 * can't call useRouter itself. Renders nothing visible.
 */
export function PrefetchOnView({ routes, rootMargin = "800px" }: { routes: string[]; rootMargin?: string }) {
  const router = useRouter();
  const { ref, inView } = useInView<HTMLSpanElement>({ rootMargin });
  useEffect(() => {
    if (!inView) return;
    for (const r of routes) router.prefetch(r);
  }, [inView, routes, router]);
  return <span ref={ref} aria-hidden className="block h-0" />;
}
