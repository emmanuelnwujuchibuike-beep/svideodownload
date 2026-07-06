"use client";

import { useEffect, useRef, useState } from "react";

import { whenVisible } from "@/lib/loading/priority";

/**
 * Frenz Core · Loading Engine — viewport-gated mounting.
 *
 * Below-the-fold sections wrap themselves in LazyMount so their JS, data
 * fetches and media only start when the user approaches them (default 400px
 * early — mounted by the time they arrive). Pass the section's skeleton as
 * `placeholder` so the layout never shifts; it also renders on the server,
 * keeping SSR output meaningful.
 *
 *   <LazyMount placeholder={<SuggestionsSkeleton />}>
 *     <SuggestionsRail />
 *   </LazyMount>
 */
export function LazyMount({
  children,
  placeholder = null,
  rootMargin = "400px",
  className,
}: {
  children: React.ReactNode;
  placeholder?: React.ReactNode;
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => whenVisible(ref.current, () => setShow(true), { rootMargin }), [rootMargin]);

  return (
    <div ref={ref} className={className}>
      {show ? children : placeholder}
    </div>
  );
}
