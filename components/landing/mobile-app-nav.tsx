"use client";

import { History, Headset } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  FrenzHomeSolid,
  FrenzPersonSolid,
  FrenzReelsOutline,
} from "@/components/icons/frenz-icons";
import { cn } from "@/lib/utils";

/**
 * The app-style bottom nav for the marketing site — a plain, OPAQUE, edge-to-edge
 * bar (owner, 2026-08: "remove the glass feel and transparent look and make it edge
 * to edge, only native apps will have glass floating nav"). Matches the signed-in
 * bottom nav (features/app-shell/mobile-nav.tsx) and AppTopbar exactly: full-width,
 * square corners, solid `bg-background`, a hairline top border, NO blur, NO floating
 * margins — so the browser's own bottom safe-area never shows through a gap. The
 * previous liquid-glass floating pill is gone; that look is reserved for a future
 * real native app shell, not the web/PWA chrome. Mounted from the marketing layout.
 *
 * ── Real routes only ──────────────────────────────────────────────────────────
 * Home → the landing; Reels → the full-screen deck; History → the download library;
 * Support → the help + 1:1 admin-chat page; Profile → the landing profile doorway
 * (which routes on to /login). A nav item that 404s is the chrome version of the
 * defect the Reality Ledger catches in copy.
 *
 * The active item is derived from the CURRENT path (usePathname) — like the
 * signed-in bottom nav — so the highlight moves with you as you navigate. Active
 * reads as a flat inline color change (muted → brand blue), Facebook/Snapchat
 * style, not a raised gradient badge. Mobile only (`lg:hidden`): desktop has the
 * full header.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: FrenzHomeSolid },
  { href: "/reels", label: "Reels", icon: FrenzReelsOutline },
  { href: "/library", label: "History", icon: History },
  { href: "/support", label: "Support", icon: Headset },
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
      // Edge-to-edge, flush with the true bottom of the viewport — the bar itself
      // owns the safe-area inset (home-indicator on installed devices; zero extra
      // gap on a plain browser tab) rather than floating inside a wrapper.
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-border/60 bg-background px-1 pb-[max(env(safe-area-inset-bottom),0.4rem)] pt-2 lg:hidden"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            prefetch
            className="flex flex-1 flex-col items-center gap-1 py-0.5"
          >
            <item.icon
              className={cn(
                "h-[22px] w-[22px] transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium leading-none transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
