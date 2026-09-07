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
        "sticky z-20 -mx-3 mb-6 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // Opaque, or the page scrolls visibly through the tabs.
        "bg-background",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        // Far enough to clear its own height plus the padding, so no sliver is
        // left peeking below the topbar.
        hidden ? "-translate-y-[150%]" : "translate-y-0",
      )}
      /*
        Sits directly under AppTopbar, which is `sticky top-0` at
        h-[calc(4rem+var(--frenz-safe-top))]. Written as the same expression
        rather than a magic number so the two cannot drift apart, and so the
        notch inset is honoured on an installed PWA.
      */
      style={{ top: "calc(4rem + var(--frenz-safe-top))" }}
    >
      <ul className="flex min-w-max items-center gap-1.5">
        {TABS.map((tab) => {
          // `/studio` must not light up for `/studio/content`, so the home tab
          // matches exactly while the rest match their subtree.
          const active = tab.href === "/studio" ? pathname === "/studio" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                )}
              >
                <tab.icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
