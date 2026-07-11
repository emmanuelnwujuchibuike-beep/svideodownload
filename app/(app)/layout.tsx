import type { ReactNode } from "react";

import { AppOverlays } from "@/features/app-shell/app-overlays";
import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { DeviceCheck } from "@/features/app-shell/device-check";
import { FloatingMessages } from "@/features/app-shell/floating-messages";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { OfflineQueueSync } from "@/features/app-shell/offline-queue-sync";
import { AutoAwayTracker, PresenceTracker } from "@/features/friends/use-presence";
import { NotificationLiveToast } from "@/features/notifications/live-toast";
import { InboxRealtimeTracker } from "@/features/social/inbox";
import { ReactionFloatLayer } from "@/features/ui/reaction-float";
import { Toaster } from "@/features/ui/toast";

/**
 * Persistent app shell for signed-in surfaces. Rendered ONCE and preserved across
 * client-side navigation between (app) pages, so the sidebar, topbar, mobile nav
 * and modals never reload — only the page content swaps. This is what makes
 * navigation feel native/instant instead of a full page rebuild each time.
 *
 * Deliberately synchronous (no auth/profile fetch): the shell must paint in the
 * first render pass, never block on a network round-trip (Stage 1 of the
 * loading architecture — see loading-architecture memory). `AppSidebar` takes a
 * `handle` prop only for signature stability (its own nav build ignores it —
 * see the comment on `buildNav`); the real per-user handle it needs elsewhere
 * (e.g. MobileNav's profile link) comes from the client-cached `/api/me` via
 * `useEntitlements`, not a server fetch here. Each page keeps its own auth guard.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar handle={null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        {children}
      </div>
      <MobileNav />
      <FloatingMessages />
      <Toaster />
      {/* Floating-reaction layer — Wow taps rise from the tap point. */}
      <ReactionFloatLayer />
      {/* Live in-app drop-down notification. */}
      <NotificationLiveToast />
      {/* Heavy, hidden-until-triggered overlays — code-split out of the initial
          bundle (composer, Story Studio, download player, iOS install nudge). */}
      <AppOverlays />
      {/* Joins the shared presence channel so this user shows as online. */}
      <PresenceTracker />
      {/* available <-> away after 5 minutes idle; never touches a manually
          chosen Busy/DND/Invisible. */}
      <AutoAwayTracker />
      {/* Live inbox badge — was dead code before, only updated while a thread was open. */}
      <InboxRealtimeTracker />
      {/* Replays any offline-queued Like/Save writes on load + reconnect. */}
      <OfflineQueueSync />
      {/* Once-per-browser-session "new device" security check. */}
      <DeviceCheck />
    </div>
  );
}
