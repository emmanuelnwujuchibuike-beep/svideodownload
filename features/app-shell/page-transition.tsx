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

/**
 * The whole `/messages` subtree opts out of the WRAPPER slide — for two different
 * reasons that share one mechanism (a transformed wrapper is a containing block).
 *
 * 1. The inbox INDEX (`/messages`). Every other (app) page's top chrome is the
 *    persistent `AppTopbar` in `(app)/layout.tsx` — ABOVE this template — so it
 *    sits still while only the body slides. The inbox hides that global topbar
 *    (app-topbar.tsx: `onMessagesIndex && "hidden lg:flex"`) and renders its OWN
 *    header (the "Messages" title, the profile/tools cluster) and the Stories
 *    strip INSIDE the page. Sliding the wrapper therefore dragged that chrome
 *    across the screen on every navigation — most visibly an iOS back-swipe out of
 *    a chat — which reads as the "story section and profile button shake on every
 *    back swipe" the owner has reported repeatedly (2026-07-17: "i need them to
 *    never shake at all … why is the chat page different and has always been the
 *    issue"). Held still, the inbox chrome matches every other page's topbar.
 *
 * 2. A THREAD (`/messages/[id]`, and the secret/new rooms). Each is a
 *    `position: fixed inset-0 z-50` overlay meant to cover the bottom nav. If the
 *    wrapper is mid-transform, it becomes that overlay's containing block, so the
 *    overlay is sized to the content column (which reserves nav space) rather than
 *    the viewport — and the bottom nav shows THROUGH the chat (owner, 2026-07-17:
 *    "the bottom nav went inside the chat"). Kept off the wrapper slide, the
 *    overlay stays viewport-fixed and covers the nav; the thread animates ITSELF
 *    via `.thread-enter` (globals.css) so entering a chat still slides in.
 */
function noSlideFor(pathname: string): boolean {
  return pathname === "/messages" || pathname.startsWith("/messages/");
}

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
    // Maintain the stack even for no-slide routes so a LATER navigation still
    // reads its direction correctly (e.g. /messages → /home → back to /messages);
    // only the visible animation is suppressed for them.
    const noSlide = noSlideFor(pathname);
    if (firstMount) {
      firstMount = false;
      navStack.push(pathname);
      cls.current = ""; // initial load — the boot splash owns this frame
    } else if (navStack.length >= 2 && navStack[navStack.length - 2] === pathname) {
      navStack.pop(); // returned to the previous page
      cls.current = noSlide ? "" : "page-transition-back";
    } else {
      navStack.push(pathname);
      cls.current = noSlide ? "" : "page-transition-forward";
    }
  }

  return <div className={`${wrapperClassName} ${cls.current}`}>{children}</div>;
}
