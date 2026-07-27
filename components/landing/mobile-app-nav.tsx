"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  FrenzHomeSolid,
  FrenzPersonSolid,
  FrenzReelsOutline,
} from "@/components/icons/frenz-icons";
import { cn } from "@/lib/utils";

/**
 * The app-style bottom nav for the marketing site — a premium LIQUID-GLASS bar
 * (iOS 26 / WhatsApp style: translucent, heavily blurred + saturated, floating low)
 * pinned to the bottom on mobile, on EVERY marketing page (owner: "the bottom nav is
 * supposed to be in all pages … make it premium liquid glass just like ios whatsapp
 * … go more below to match native-app feel"). Mounted from the marketing layout.
 *
 * ── Real routes only ──────────────────────────────────────────────────────────
 * Reels → the full-screen deck; History → the download library; Home → the landing;
 * Profile → the landing profile page (which routes on to /login). A nav item that
 * 404s is the chrome version of the defect the Reality Ledger catches in copy.
 *
 * The active item is derived from the CURRENT path (usePathname) — like the
 * signed-in bottom nav — so the highlight moves with you as you navigate, instead
 * of being pinned to Home (the previous bug: `active: true` hardcoded on Home, so
 * it never showed the real page and looked like tapping "didn't move" anywhere).
 *
 * Mobile only (`lg:hidden`): desktop has the full header. The wrapper is
 * click-through except the pill, and it clears the home-indicator inset while
 * sitting as low as the safe area allows.
 */
const ITEMS = [
  { href: "/reels", label: "Reels", icon: FrenzReelsOutline },
  { href: "/library", label: "History", icon: History },
  { href: "/", label: "Home", icon: FrenzHomeSolid },
  { href: "/profile", label: "Profile", icon: FrenzPersonSolid },
] as const;

/** Is `href` the active route for the current path? Home matches only exactly;
 *  the others match their section (so /reels/123 still lights up Reels). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileAppNav() {
  const pathname = usePathname() || "/";
  return (
    <nav
      aria-label="App"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {/* Liquid glass: translucent card, heavy blur + saturation, a bright hairline
          top edge (the "glass" highlight) and a soft floating shadow. */}
      <div className="pointer-events-auto mx-auto flex max-w-sm items-center justify-around gap-1 rounded-[1.9rem] border border-white/50 bg-white/55 px-2 py-1.5 shadow-[0_10px_40px_-8px_rgba(15,23,42,0.28)] ring-1 ring-black/[0.04] backdrop-blur-2xl backdrop-saturate-[1.8] dark:border-white/10 dark:bg-neutral-900/45 dark:ring-white/10">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              prefetch
              className="flex flex-1 flex-col items-center gap-1 rounded-2xl py-1"
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200",
                  active
                    ? "scale-105 bg-brand text-white shadow-lg shadow-violet-500/30"
                    : "text-neutral-500 dark:text-neutral-300",
                )}
              >
                <item.icon className="h-5 w-5" />
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold leading-none transition-colors",
                  active ? "text-primary" : "text-neutral-500 dark:text-neutral-300",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
