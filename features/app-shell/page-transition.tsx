"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useRef } from "react";

/**
 * Premium native-style page transition. Rendered from `app/(app)/template.tsx`,
 * which — unlike a layout — creates a NEW instance on every navigation, so this
 * component re-mounts each time the user moves between (app) pages and the CSS
 * animation on its wrapper plays once per navigation.
 *
 * Placed at the (app) TEMPLATE, not the root: a root template would re-mount the
 * whole app shell (sidebar/topbar/nav) on every navigation — the exact "reload"
 * the owner has fought. Here only the PAGE animates; the shell above is preserved.
 *
 * DIRECTION — deterministic, via a pathname stack rather than the `popstate`
 * event. popstate turned out unreliable here: it's timing-sensitive against a
 * force-dynamic route's server round-trip, and it doesn't distinguish a Router
 * Cache restore. Instead we keep a small stack of visited paths and read the
 * destination against it at mount:
 *   - destination === the entry just below the top  → BACK  (pop, slide from LEFT)
 *   - otherwise                                      → FORWARD (push, slide from RIGHT)
 * That is exactly right for the common linear case (A→B forward, B→A back) and
 * degrades gracefully on the rare revisit/jump case (a wrong-direction slide is
 * still smooth). No event timing, no Router-Cache surprises.
 *
 * The very first mount (initial load / full refresh) does NOT animate — the boot
 * splash already owns that moment, and animating it would fight the splash.
 *
 * Scroll is left to Next's `scrollRestoration` (next.config): back/forward restore
 * the prior position, forward starts at top. The transform wrapper never becomes a
 * scroll container, so it can't jump the scroll. And because the CSS keyframes end
 * at `transform: none` (no fill-mode), the wrapper carries NO transform at rest —
 * so it never becomes a containing block that would break `position:fixed`
 * descendants once the ~240ms animation finishes.
 */

let firstMount = true;
const navStack: string[] = [];

export function PageTransition({
  children,
  wrapperClassName = "flex min-h-0 flex-1 flex-col",
}: {
  children: ReactNode;
  /**
   * Layout classes for the animated wrapper. Defaults to the flex-fill that (app)
   * pages need (they live in the shell's flex column). Marketing pages flow
   * normally in the document, so they pass a plain wrapper — a flex-fill there
   * would be inert at best and could fight a normal scrolling page.
   */
  wrapperClassName?: string;
}) {
  const pathname = usePathname();

  // Compute the direction class exactly once per mount. A ref guard keeps it
  // stable across React StrictMode's double render so the stack isn't mutated
  // twice for one navigation.
  const cls = useRef<string | null>(null);
  if (cls.current === null) {
    if (firstMount) {
      firstMount = false;
      navStack.push(pathname);
      cls.current = ""; // initial load — the boot splash owns this frame
    } else if (navStack.length >= 2 && navStack[navStack.length - 2] === pathname) {
      navStack.pop(); // returned to the previous page
      cls.current = "page-transition-back";
    } else {
      navStack.push(pathname);
      cls.current = "page-transition-forward";
    }
  }

  return <div className={`${wrapperClassName} ${cls.current}`}>{children}</div>;
}
