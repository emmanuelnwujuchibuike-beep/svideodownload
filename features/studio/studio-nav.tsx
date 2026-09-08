"use client";

import { BarChart3, CalendarDays, Compass, LayoutGrid, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { cn } from "@/lib/utils";

/**
 * Studio navigation (Feature 15 · Part 9).
 *
 * A client component only because it needs `usePathname` to mark the active
 * tab. It renders real `<Link>`s, so it works before hydration — a tap on a
 * cold page is a normal navigation, not a dead one. That matters here: this
 * project has a standing incident where a pre-hydration tap on a form was a
 * native submit, and links are the shape that never has that problem.
 *
 * Horizontally scrollable on mobile with the scrollbar hidden, which is how the
 * rest of the app's tab rows behave.
 *
 * ── It follows you, and gets out of the way ─────────────────────────────────
 *
 * Owner, 2026-09-07: "Let this top nav also be in the signed in Download page
 * and it should be hide when a user scrolls down and show when a users scrolls
 * up."
 *
 * Sticky under the app topbar, and it slides up out of sight while the page is
 * being scrolled DOWN — the reading direction, where a bar of tabs is only
 * taking space — then comes straight back on the first upward movement, which
 * is the gesture somebody makes when they want to navigate.
 *
 * 🔴 The direction comes from `useScrollDirection`, the app's SINGLE shared
 * scroll store — not a listener of this component's own. The bottom nav and the
 * bottom ad banner already read it, and they have to agree frame for frame: a
 * commit where one bar has moved and another has not is exactly the "pop up"
 * the owner rejected when that hook was written. It also costs nothing extra —
 * one passive listener for the whole app, however many bars subscribe.
 *
 * The bar keeps its space in the flow while hidden (sticky, translated), so
 * nothing below it reflows and the page does not jump under a reading finger.
 * It slides UNDER the topbar, which is opaque, so it disappears rather than
 * showing through it.
 *
 * ── 🔴 IT IS FLUSH WITH THE HEADER, AND THAT TAKES A NEGATIVE MARGIN ─────────
 *
 * Owner, 2026-09-08: "it shouldn't give that white space between the header and
 * the NAV, and below the NAV there are much space between the NAV and the hero."
 *
 * `AppContent` opens its `<main>` with `pt-4`, so anything placed first inside
 * it starts 16px down — a gap this bar cannot close by styling itself. `-mt-4`
 * cancels exactly that padding, and `-mx-3 sm:-mx-4` cancels the horizontal
 * padding so the rule underneath runs the full width like real chrome rather
 * than stopping short like a card. Both are tied to the values in that
 * component; if its padding changes, these change with it.
 *
 * The bottom hairline is what makes the bar READ as attached to the header:
 * without it, a floating strip of tabs with air on both sides looks like a
 * component that failed to align.
 *
 * ── The dividers ────────────────────────────────────────────────────────────
 *
 * A short vertical hairline between tabs, centred and inset — not a full-height
 * `border-l`, which would draw a table. The active tab is a gradient underline
 * and gradient text rather than a solid filled pill: a flat blue lozenge is the
 * "not premium" the owner was pointing at, and light on the edge of a shape
 * reads more expensive than paint across the whole of it.
 */

const TABS = [
  { href: "/studio", label: "Home", icon: LayoutGrid },
  // Frenz AI (2026-09-07). Second, not last: it is the section the owner is
  // building out, and the tab row scrolls on a phone — anything past the fourth
  // tab is off-screen on arrival and is discovered by accident or never.
  { href: "/studio/ai", label: "Frenz AI", icon: Sparkles },
  { href: "/studio/content", label: "Content", icon: BarChart3 },
  { href: "/studio/audience", label: "Audience", icon: Users },
  { href: "/studio/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/studio/journey", label: "Journey", icon: Compass },
] as const;

export function StudioNav() {
  const pathname = usePathname();
  const direction = useScrollDirection();
  const hidden = direction === "down";

  return (
    <nav
      aria-label="Creator Studio"
      className={cn(
        "sticky z-20 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // Flush with the header above and tight to the content below — see the
        // note about AppContent's padding.
        "-mx-3 -mt-4 mb-3 px-3 sm:-mx-4 sm:px-4",
        // Opaque, or the page scrolls visibly through the tabs. The hairline is
        // what attaches it to the header rather than leaving it floating.
        "border-b border-border/60 bg-background",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        // Its own height is enough: the bar's top sits at the topbar's bottom
        // edge, so moving up by one height puts all of it inside that opaque
        // band. -150% used to overshoot into the status bar for no benefit.
        hidden ? "-translate-y-full" : "translate-y-0",
      )}
      /*
        Sits directly under AppTopbar, which is `sticky top-0` at
        h-[calc(4rem+var(--frenz-safe-top))]. Written as the same expression
        rather than a magic number so the two cannot drift apart, and so the
        notch inset is honoured on an installed PWA.
      */
      style={{ top: "calc(4rem + var(--frenz-safe-top))" }}
    >
      <ul className="flex min-w-max items-stretch">
        {TABS.map((tab, i) => {
          // `/studio` must not light up for `/studio/content`, so the home tab
          // matches exactly while the rest match their subtree.
          const active = tab.href === "/studio" ? pathname === "/studio" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="relative">
              {/*
                The divider. A short centred hairline rather than a full-height
                border — it separates without ruling the bar into cells.
              */}
              {i > 0 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-border/70"
                />
              ) : null}

              <Link
                href={tab.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2 px-4 py-3 text-sm font-semibold outline-none transition",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon
                  className={cn("h-4 w-4 transition-colors", active ? "text-primary" : "")}
                  aria-hidden
                />
                {/*
                  Gradient TYPE on the active tab. `.text-gradient` is the app's
                  shared brand sweep, so this is the same blue-to-purple the
                  wordmark and the AI Core use rather than a third one.
                */}
                <span className={active ? "text-gradient" : undefined}>{tab.label}</span>

                {/*
                  The indicator. Sits on the bar's own bottom rule, so the active
                  tab looks like it is holding the line up — the detail that
                  makes a tab row read as chrome instead of as buttons.
                */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-blue-600 via-violet-500 to-fuchsia-500"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
