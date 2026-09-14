import type { ReactNode } from "react";

import { AppOverlays } from "@/features/app-shell/app-overlays";
import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { MobileNav } from "@/features/app-shell/mobile-nav";

/**
 * Profile pages get the same shell as the rest of the app on desktop — the
 * home-style left sidebar + top bar — so navigation is identical everywhere.
 * On mobile the page's own top bar + the bottom MobileNav own navigation (the
 * desktop sidebar/topbar are hidden on small screens), so nothing is duplicated.
 *
 * Deliberately synchronous — no auth/profile fetch. `handle` only exists for
 * `AppSidebar`'s prop signature (its nav build ignores it); the shell must
 * paint instantly regardless of auth state, never block on a round-trip.
 * Each child page keeps its own guard.
 */
export default function ProfileSectionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar handle={null} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar — mobile uses the page's own SiteHeader instead */}
        <div className="hidden lg:block">
          <AppTopbar />
        </div>
        {children}
      </div>
      <MobileNav />
      <AppOverlays />
    </div>
  );
}
