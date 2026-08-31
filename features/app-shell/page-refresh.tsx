"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { PullToRefresh } from "@/features/ui/pull-to-refresh";

/**
 * App-wide pull-to-refresh (owner, 2026-08-30: "Put a drag down to refresh in
 * all pages, Download, landing, reels, profile, settings, Friends and all").
 *
 * Mounted once in each route group's layout rather than page by page, so a page
 * added tomorrow inherits the gesture instead of being the one that quietly
 * does not have it.
 *
 * ── What "refresh" means here ────────────────────────────────────────────────
 *
 * `router.refresh()` — it re-runs the server components for the current route
 * and reconciles the result into the existing tree. That is the correct verb
 * for this app: nearly every page is server-rendered data (history, friends,
 * profile, settings, the downloader's own hero), so re-fetching THAT is exactly
 * what someone dragging down is asking for. It also keeps scroll position and
 * client state, unlike `location.reload()`, which would throw away an
 * in-progress download and re-run the whole PWA boot for a gesture that is
 * supposed to be cheap.
 *
 * ── 🔴 The opt-outs, and why each one is not laziness ────────────────────────
 *
 * Two kinds of page must NOT get this, and both would be actively broken by it:
 *
 *  1. **Vertical full-screen scrollers** (`/reels`). They are their own
 *     scroll container, so `window.scrollY` is permanently 0 — which is the
 *     exact condition PullToRefresh arms on. Every downward swipe to reach the
 *     previous reel would instead be read as a pull-to-refresh. The reels
 *     viewer already owns a deliberate, much-iterated vertical gesture; putting
 *     a second interpreter on top of the same touch stream is how that gets
 *     broken. Reels also has nothing to refresh — it pages an infinite feed.
 *
 *  2. **Anything with its own pull gesture already.** The Home feed's
 *     `SmartFeed` interleaves pull-to-refresh with horizontal tab-swipe
 *     detection in one hand-rolled handler (see PullToRefresh's own note), and
 *     Explore and the notification centre each mount `PullToRefresh`
 *     themselves. Wrapping those again would nest two gesture handlers on one
 *     touch and fire two refreshes per pull.
 *
 * Matching on pathname is deliberate over a context flag: an opt-out that a
 * page has to remember to set is an opt-out that the next page forgets, and the
 * failure mode there is a broken scroller rather than a missing nicety.
 */

/** Route prefixes that own their vertical gesture, or their own pull handler. */
const EXCLUDED_PREFIXES = [
  // Full-screen vertical scrollers — see (1) above.
  "/reels",
  // Owns a combined pull + horizontal-tab-swipe handler — see (2) above.
  "/home",
  // Mounts PullToRefresh itself.
  "/explore",
  "/notifications",
  // A full-screen media surface with its own drag-to-dismiss.
  "/wallpapers",
];

function isExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function PageRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";

  const onRefresh = useCallback(async () => {
    router.refresh();
    /*
      `router.refresh()` does not return a promise, and the spinner is only
      honest if it stays up while the work happens. A short floor gives the
      server round trip somewhere to land and stops the indicator flashing out
      in one frame, which reads as "nothing happened".
    */
    await new Promise((resolve) => setTimeout(resolve, 450));
  }, [router]);

  if (isExcluded(pathname)) return <>{children}</>;

  return <PullToRefresh onRefresh={onRefresh}>{children}</PullToRefresh>;
}
