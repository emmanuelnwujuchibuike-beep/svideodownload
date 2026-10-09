"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the element has been on screen. Admin tabs are mounted but hidden
 * until chosen, so a panel uses this to fetch only when the admin actually
 * opens its tab — never on page load, never polled.
 */
export function useShownOnce<T extends Element>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return { ref, shown };
}
