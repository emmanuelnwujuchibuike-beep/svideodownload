"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { DeferredPart } from "@/lib/landing/deferred-sections";

/**
 * A landing section that is not in the document (owner, 2026-10-19: "below section shouldn't load on
 * landing"). It renders an empty, sized placeholder carrying the section's anchor id. Nothing is
 * fetched on a page view that never scrolls: after the visitor's FIRST scroll, a placeholder within
 * about a screen of the viewport — or one the visitor arrived on by its #anchor — fetches the static
 * `/landing-sections` once (all parts in one cached response, shared by every placeholder) and fills
 * in its part. See lib/landing/deferred-sections.ts.
 *
 * The placeholder's min-height is the section's measured height at phone width, so the page is the
 * right length before anything loads and the footer doesn't jump. Fails open: a failed fetch leaves
 * the space empty and lets the next scroll try again.
 */

let pending: Promise<Partial<Record<DeferredPart, string>>> | null = null;

/* The first scroll of the page, shared by every placeholder. Measured 2026-10-19: the first
   placeholder sits within a screen of the hero's bottom, so an observer alone fetched on page load. */
let scrolled = false;
const waiting = new Set<() => void>();
function afterFirstScroll(cb: () => void) {
  if (scrolled) {
    cb();
    return () => {};
  }
  if (waiting.size === 0) {
    const go = () => {
      scrolled = true;
      window.removeEventListener("scroll", go);
      const all = [...waiting];
      waiting.clear();
      for (const f of all) f();
    };
    window.addEventListener("scroll", go, { passive: true });
  }
  waiting.add(cb);
  return () => void waiting.delete(cb);
}

function loadParts() {
  pending ??= fetch("/landing-sections")
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Record<DeferredPart, string>>>) : Promise.reject(new Error(String(r.status)))))
    .catch(() => {
      pending = null;
      return {};
    });
  return pending;
}

export function DeferredSection({ part, id, minHeight }: { part: DeferredPart; id: string; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const el = ref.current;
    if (!el || html) return;
    let live = true;
    const fill = () =>
      void loadParts().then((parts) => {
        const h = parts[part];
        if (live && h) setHtml(h);
      });
    if (window.location.hash === `#${id}`) {
      fill();
      return () => {
        live = false;
      };
    }
    let io: IntersectionObserver | null = null;
    const stopWaiting = afterFirstScroll(() => {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          fill();
        },
        { rootMargin: "1000px 0px" },
      );
      io.observe(el);
    });
    return () => {
      live = false;
      stopWaiting();
      io?.disconnect();
    };
  }, [part, id, html]);

  // The markup's links are plain anchors; an internal one navigates in-app, so it stays instant.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    // an anchor on this same page scrolls natively
    if (url.pathname === window.location.pathname && url.hash) return;
    e.preventDefault();
    a.setAttribute("data-pending", "");
    router.push(url.pathname + url.search + url.hash);
  };

  return (
    <div
      ref={ref}
      id={id}
      className="scroll-mt-24"
      style={html ? undefined : { minHeight }}
      onClick={html ? onClick : undefined}
      // the HTML is our own build-time markup from lib/landing/deferred-sections.ts — never user content
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}
