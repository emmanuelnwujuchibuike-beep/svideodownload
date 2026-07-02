import type { ReactNode } from "react";

import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { UploadModal } from "@/features/create/upload-modal";
import { DownloadPlayer } from "@/features/downloads/download-player";
import { PresenceTracker } from "@/features/friends/use-presence";
import { IosInstallPrompt } from "@/features/notifications/ios-install-prompt";
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
      <UploadModal />
      <DownloadPlayer />
      <Toaster />
      {/* Live in-app drop-down notification + iOS "install for push" nudge. */}
      <NotificationLiveToast />
      <IosInstallPrompt />
      {/* Joins the shared presence channel so this user shows as online. */}
      <PresenceTracker />
    </div>
  );
}
