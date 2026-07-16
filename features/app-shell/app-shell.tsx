import type { ReactNode } from "react";

import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { RightRail } from "@/features/app-shell/right-rail";
import { DownloadPlayer } from "@/features/downloads/download-player";
import { Toaster } from "@/features/ui/toast";
import type { HomeProfile } from "@/lib/social/home";
import type { SuggestedCreator } from "@/lib/social/suggest";

/** Authenticated app frame: left nav, top bar, center column, right rail,
 * and a mobile bottom nav. Distinct from the marketing SiteHeader. */
export function AppShell({
  handle,
  profile,
  suggestions,
  rightRail,
  children,
}: {
  handle: string | null;
  profile?: HomeProfile | null;
  suggestions?: SuggestedCreator[];
  /** Override the default home right rail (e.g. the Downloads page rail). */
  rightRail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar handle={handle} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
          <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">{children}</main>
          {rightRail ?? <RightRail profile={profile ?? null} suggestions={suggestions ?? []} />}
        </div>
      </div>

      <MobileNav />
      <DownloadPlayer />
      <Toaster />
    </div>
  );
}
