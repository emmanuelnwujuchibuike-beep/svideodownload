import { History } from "lucide-react";
import Link from "next/link";

import {
  FrenzHomeSolid,
  FrenzPersonSolid,
  FrenzReelsOutline,
} from "@/components/icons/frenz-icons";
import { cn } from "@/lib/utils";

/**
 * The landing page's app-style bottom nav — a fixed bar pinned to the bottom on
 * mobile, matching `public/newlanding.jpg` (owner chose the "fixed overlay"
 * treatment). It gives the marketing page a native-app feel and hands a
 * signed-out visitor the four doors the app opens with.
 *
 * ── Real routes only ──────────────────────────────────────────────────────────
 * Reels → the full-screen deck; History → the download library; Home → here;
 * Profile → sign-in (a signed-out visitor has no profile yet). A nav item that
 * 404s is the chrome version of the defect the Reality Ledger catches in copy.
 *
 * Mobile only (`lg:hidden`): desktop already has the full header. The wrapper is
 * click-through (`pointer-events-none`) except the pill itself, so it never traps
 * a tap on the page behind it, and it clears the home-indicator inset.
 */
const ITEMS = [
  { href: "/reels", label: "Reels", icon: FrenzReelsOutline },
  { href: "/library", label: "History", icon: History },
  { href: "/", label: "Home", icon: FrenzHomeSolid, active: true },
  { href: "/login", label: "Profile", icon: FrenzPersonSolid },
] as const;

export function MobileAppNav() {
  return (
    <nav
      aria-label="App"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="pointer-events-auto mx-auto flex max-w-sm items-center justify-around rounded-full border border-border/60 bg-card/95 px-2 py-1.5 shadow-2xl backdrop-blur-md">
        {ITEMS.map((item) => {
          const active = "active" in item && item.active;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5"
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition",
                  active
                    ? "bg-brand text-white shadow-lg shadow-violet-500/30"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold leading-none",
                  active ? "text-primary" : "text-muted-foreground",
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
