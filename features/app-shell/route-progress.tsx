"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The slim gradient stripe that sits directly UNDER the top bar and fills while a
 * page is on its way (owner, 2026-08: "make all skeleton loading in all pages show
 * a stripe loader under the top header ... so everything dont always show white").
 *
 * This is the DETERMINATE, click-driven half of the system: a NProgress-style bar
 * that starts the instant a link is tapped (before the server has even answered),
 * trickles toward ~92%, then snaps to 100% and fades the moment the URL settles.
 * The other half is `RouteLoaderStripe` below — a pure-CSS indeterminate segment
 * baked into every route's `loading.tsx` skeleton, so a slow server render keeps a
 * moving stripe under the header for its whole duration too. Together the top of
 * the viewport is never a dead white band during a navigation.
 *
 * Mounted ONCE in the root layout so it persists across navigations (a template
 * would remount it and lose the in-flight bar). It only reads `usePathname()` on
 * the client, so it never opts a static page out of prerendering.
 *
 * Positioned at the header's bottom edge — `--frenz-safe-top` (the notch inset the
 * top bars already pad for) plus the shared 4rem bar height. On the rare full-
 * screen route with no top bar the stripe simply rides a little below the top; it
 * only shows for the brief moment of a transition, so it is never in the way.
 */
const TRICKLE_MS = 240;
const SAFETY_MS = 12000;

export function RouteProgress() {
  const pathname = usePathname();
  const [value, setValue] = useState(0); // 0 → 1
  const [active, setActive] = useState(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPath = useRef(true);

  useEffect(() => {
    const clearTimers = () => {
      if (trickle.current) clearInterval(trickle.current);
      if (safety.current) clearTimeout(safety.current);
      trickle.current = null;
      safety.current = null;
    };

    const start = () => {
      if (hide.current) {
        clearTimeout(hide.current);
        hide.current = null;
      }
      clearTimers();
      setActive(true);
      setValue(0.08);
      trickle.current = setInterval(() => {
        // Diminishing steps so it eases toward — but never reaches — the end,
        // the way a real progress bar feels: fast at first, crawling near 90%.
        setValue((v) => (v >= 0.92 ? v : v + (0.92 - v) * 0.12));
      }, TRICKLE_MS);
      // If a navigation never resolves (or was a same-doc no-op we failed to
      // catch), don't strand the bar at 92% forever.
      safety.current = setTimeout(() => finish(), SAFETY_MS);
    };

    const finish = () => {
      clearTimers();
      setValue(1);
      hide.current = setTimeout(() => {
        setActive(false);
        // Reset only after the fade so the width doesn't visibly rewind.
        hide.current = setTimeout(() => setValue(0), 200);
      }, 220);
    };

    // Instant feedback on intent: a click on an internal link starts the bar
    // before Next has fetched anything. Capture phase so we see it even when the
    // link stops propagation.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest("a");
      if (!el) return;
      const href = el.getAttribute("href");
      const target = el.getAttribute("target");
      if (!href || href.startsWith("#") || target === "_blank" || el.hasAttribute("download")) return;
      if (/^(https?:)?\/\//i.test(href) && el.getAttribute("href")?.startsWith(location.origin) === false) {
        // Absolute URL to another origin — a real page leave, not an SPA nav.
        if (!href.startsWith(location.origin)) return;
      }
      let dest: URL;
      try {
        dest = new URL(href, location.href);
      } catch {
        return;
      }
      if (dest.origin !== location.origin) return;
      // Same path (a hash/query-only jump or a re-tap of the current page) never
      // triggers a load boundary, so starting the bar would strand it.
      if (dest.pathname === location.pathname) return;
      start();
    };

    // Programmatic navigations (router.push/replace) go through history; patch it
    // so those start the bar too. popstate covers browser/gesture back-forward.
    const origPush = history.pushState;
    const patchedPush: typeof history.pushState = function (this: History, ...args) {
      const url = args[2];
      if (url != null) {
        try {
          if (new URL(String(url), location.href).pathname !== location.pathname) start();
        } catch {
          /* ignore malformed */
        }
      }
      return origPush.apply(this, args);
    };
    history.pushState = patchedPush;

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", start);

    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", start);
      if (history.pushState === patchedPush) history.pushState = origPush;
      clearTimers();
      if (hide.current) clearTimeout(hide.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL settling is the "done" signal — the transition has committed and the
  // page (or its loading skeleton) is now on screen. Skip the first run so a fresh
  // page load doesn't flash the bar.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    if (trickle.current) clearInterval(trickle.current);
    if (safety.current) clearTimeout(safety.current);
    trickle.current = null;
    safety.current = null;
    setValue(1);
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => {
      setActive(false);
      hide.current = setTimeout(() => setValue(0), 200);
    }, 220);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-[45]"
      style={{ top: "calc(var(--frenz-safe-top, 0px) + 4rem)" }}
    >
      <div
        className="h-0.5 origin-left bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500 shadow-[0_0_10px_hsl(var(--primary)/0.7)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${value * 100}%`, opacity: active ? 1 : 0 }}
      />
    </div>
  );
}
