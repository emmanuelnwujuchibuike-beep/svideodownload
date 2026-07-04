import type { ReactNode } from "react";

import { AppOverlays } from "@/features/app-shell/app-overlays";
import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { getHomeProfile } from "@/lib/social/home";
import { createClient } from "@/lib/supabase/server";

/**
 * Profile pages get the same shell as the rest of the app on desktop — the
 * home-style left sidebar + top bar — so navigation is identical everywhere.
 * On mobile the page's own top bar + the bottom MobileNav own navigation (the
 * desktop sidebar/topbar are hidden on small screens), so nothing is duplicated.
 *
 * Anonymous-safe: public profiles still render for signed-out visitors
 * (`handle = null`); each page keeps its own guard.
 */
export default async function ProfileSectionLayout({ children }: { children: ReactNode }) {
  let handle: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const profile = await getHomeProfile(user.id);
      handle = profile?.handle ?? null;
    }
  } catch {
    /* anonymous — render the shell in signed-out mode */
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar handle={handle} />
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
