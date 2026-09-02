"use client";

import { BarChart3, CalendarDays, Compass, LayoutGrid, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
 */

const TABS = [
  { href: "/studio", label: "Home", icon: LayoutGrid },
  { href: "/studio/content", label: "Content", icon: BarChart3 },
  { href: "/studio/audience", label: "Audience", icon: Users },
  { href: "/studio/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/studio/journey", label: "Journey", icon: Compass },
] as const;

export function StudioNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Creator Studio" className="mb-6 -mx-3 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
