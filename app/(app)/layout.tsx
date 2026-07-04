import type { ReactNode } from "react";

import { AppOverlays } from "@/features/app-shell/app-overlays";
import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { FloatingMessages } from "@/features/app-shell/floating-messages";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { PresenceTracker } from "@/features/friends/use-presence";
import { NotificationLiveToast } from "@/features/notifications/live-toast";
import { Toaster } from "@/features/ui/toast";
import { getHomeProfile } from "@/lib/social/home";
import { createClient } from "@/lib/supabase/server";

/**
 * Persistent app shell for signed-in surfaces. Rendered ONCE and preserved across
 * client-side navigation between (app) pages, so the sidebar, topbar, mobile nav
 * and modals never reload — only the page content swaps. This is what makes
 * navigation feel native/instant instead of a full page rebuild each time.
 *
 * Anonymous-safe: public (app) pages (Explore, profiles) still render for
 * signed-out visitors with `handle = null`; each page keeps its own auth guard.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
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
        <AppTopbar />
        {children}
      </div>
      <MobileNav />
      <FloatingMessages />
      <Toaster />
      {/* Live in-app drop-down notification. */}
      <NotificationLiveToast />
      {/* Heavy, hidden-until-triggered overlays — code-split out of the initial
          bundle (composer, Story Studio, download player, iOS install nudge). */}
      <AppOverlays />
      {/* Joins the shared presence channel so this user shows as online. */}
      <PresenceTracker />
    </div>
  );
}
