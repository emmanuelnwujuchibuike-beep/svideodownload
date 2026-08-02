"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The slim gradient stripe that sits directly UNDER the top bar and fills only when
 * a page is genuinely still loading (owner, 2026-08: "the stripe top loader
 * shouldnt show when there is no loading at all ... i see it showing in cached
 * pages that doesnt load ... it should keep showing on pages that is still loading
 * and goes out immediately after it opens").
 *
 * ── Why the delay is the whole point ──────────────────────────────────────────
 * A navigation starts the timer but the bar does NOT appear yet. If the transition
 * commits within SHOW_DELAY_MS (a cached/instant page — nothing actually loads),
 * the pending show is cancelled and the bar never flashes. Only when a navigation
 * is still unresolved after that threshold — i.e. the screen would otherwise sit
 * blank / on a skeleton — does the bar reveal and trickle, then snap to 100% and
 * fade the instant the URL settles. So it shows for slow/blank loads and stays
 * invisible for instant ones, exactly as asked.
 *
 * The other half is `RouteLoaderStripe` — a pure-CSS indeterminate segment baked
 * into each route's `loading.tsx` skeleton, covering the time a skeleton is up.
 *
 * Mounted ONCE in the root layout so it persists across navigations (a template
 * would remount it and drop the in-flight bar). Only reads `usePathname()` on the
 * client, so it never opts a static page out of prerendering. Positioned at the
 * header's bottom edge — the safe-area inset the top bars pad for, plus the 4rem bar.
 */
const SHOW_DELAY_MS = 180; // below this, a nav is "instant" and never shows a bar
const TRICKLE_MS = 240;
const SAFETY_MS = 12000;

export function RouteProgress() {
  const pathname = usePathname();
  const [value, setValue] = useState(0); // 0 → 1
  const [active, setActive] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef(false); // is the bar currently visible?
  const firstPath = useRef(true);
  // Stable handle so the pathname effect (below) can end whatever the mount
  // effect started, without re-subscribing listeners on every navigation.
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const clearRunTimers = () => {
      if (trickle.current) clearInterval(trickle.current);
      if (safety.current) clearTimeout(safety.current);
      trickle.current = null;
      safety.current = null;
    };

    const reveal = () => {
      shown.current = true;
      setActive(true);
      setValue(0.08);
      trickle.current = setInterval(() => {
        // Diminishing steps: fast at first, crawling near 90% — real-progress feel.
        setValue((v) => (v >= 0.92 ? v : v + (0.92 - v) * 0.12));
      }, TRICKLE_MS);
      // Never strand the bar if a navigation somehow never resolves.
      safety.current = setTimeout(() => finish(), SAFETY_MS);
    };

    const start = () => {
      if (hide.current) {
        clearTimeout(hide.current);
        hide.current = null;
      }
      clearRunTimers();
      if (showTimer.current) clearTimeout(showTimer.current);
      // Defer the reveal — an instant/cached nav completes before this fires and
      // cancels it in finish(), so the bar never appears on a page that didn't load.
      showTimer.current = setTimeout(reveal, SHOW_DELAY_MS);
    };

    const finish = () => {
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
      }
      clearRunTimers();
      if (!shown.current) {
        // Never became visible (instant nav) — reset silently, no flash.
        setValue(0);
        setActive(false);
        return;
      }
      shown.current = false;
      setValue(1);
      hide.current = setTimeout(() => {
        setActive(false);
        // Reset width only after the fade so it doesn't visibly rewind.
        hide.current = setTimeout(() => setValue(0), 200);
      }, 220);
    };
    finishRef.current = finish;

    // Instant feedback on intent: a click on an internal link arms the bar before
    // Next has fetched anything. Capture phase so we see it even when the link
    // stops propagation.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest("a");
      if (!el) return;
      const href = el.getAttribute("href");
      const target = el.getAttribute("target");
      if (!href || href.startsWith("#") || target === "_blank" || el.hasAttribute("download")) return;
      let dest: URL;
      try {
        dest = new URL(href, location.href);
      } catch {
        return;
      }
      if (dest.origin !== location.origin) return;
      // Same path (a hash/query-only jump or a re-tap) never loads — don't arm.
      if (dest.pathname === location.pathname) return;
      start();
    };

    // Programmatic navigations (router.push/replace) go through history; patch it
    // so those arm the bar too. popstate covers browser/gesture back-forward.
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
      if (showTimer.current) clearTimeout(showTimer.current);
      clearRunTimers();
      if (hide.current) clearTimeout(hide.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL settling is the "done" signal — the transition has committed. For an
  // instant nav this fires before the reveal timer, so the bar never shows; for a
  // slow one it completes the visible bar. Skip the first run (fresh page load).
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    finishRef.current();
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
