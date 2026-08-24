import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

import { AppOverlays } from "@/features/app-shell/app-overlays";
import { EdgeSwipeBack } from "@/features/app-shell/edge-swipe-back";
import { OfflineBanner } from "@/features/app-shell/offline-banner";
import { StatusBarScrim } from "@/features/app-shell/status-bar-scrim";
import { ScrollPerfMonitor } from "@/features/perf/scroll-perf-monitor";
import { DeferredAnnouncement } from "@/features/announcements/deferred-announcement";
import { AppSidebar } from "@/features/app-shell/app-sidebar";
import { AppTopbar } from "@/features/app-shell/app-topbar";
import { DeviceCheck } from "@/features/app-shell/device-check";
import { FloatingMessages } from "@/features/app-shell/floating-messages";
import { MobileNav } from "@/features/app-shell/mobile-nav";
import { DownloadTopAd } from "@/features/monetization/download-top-ad";
import { OfflineQueueSync } from "@/features/app-shell/offline-queue-sync";
import { PinLockGate } from "@/features/account/pin-lock-gate";
import { InboxMobileChrome } from "@/features/social/inbox-mobile-chrome";
import { AutoAwayTracker, PresenceTracker } from "@/features/friends/use-presence";
import { NotificationLiveToast } from "@/features/notifications/live-toast";
import { InboxRealtimeTracker } from "@/features/social/inbox";
import { ReactionFloatLayer } from "@/features/ui/reaction-float";
import { CreatorNotifyNudgeHost } from "@/features/social/creator-notify-nudge";
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
    /*
      App-wide reduced-motion for the SIGNED-IN tree.

      Every framer-motion transition below this point — hundreds across dozens
      of files — collapses x/y/scale/rotate to instant under the OS "reduce
      motion" setting, with zero per-component opt-in. Opacity fades still
      play, which is the behaviour the setting actually asks for.

      It sits here rather than in the root layout because the root put
      framer-motion (39 kB gzipped) into the LANDING page's first load, and the
      marketing tree animates entirely in CSS — it was paying for a library it
      never called. Every route that genuinely uses framer is inside this
      layout, so the guarantee is unchanged where it matters.
    */
    <MotionConfig reducedMotion="user">
    <div className="flex min-h-screen">
      <AppSidebar handle={null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        {/* Premium announcement bar (admin-set) — GLOBAL: shown on every signed-in
            page too, not just downloads. Fixed below the header; the reservation
            padding below keeps the sticky ad + content clear of it. */}
        <DeferredAnnouncement />
        <div
          style={{ paddingTop: "calc(var(--frenz-announce-h, 0px) + var(--frenz-topbanner-h, 0px))" }}
          className="transition-[padding] duration-200"
        >
          {/* Sticky top ad — Downloads page only, mounted here (outside the page
              transition template) so its sticky pin is reliable. */}
          <DownloadTopAd />
          {children}
        </div>
      </div>
      <MobileNav />
      {/*
        App-shell chrome, moved here from the ROOT layout (2026-07-19).

        These four are signed-in-surface concerns: the iOS back-swipe gesture,
        the PWA status-bar scrim, the connectivity banner and the scroll-FPS
        beacon. In the root layout they also shipped to every marketing page,
        where none of them do anything — and OfflineBanner drags framer-motion
        with it. Measured: the landing page paints nothing until FCP, and FCP is
        gated on bandwidth and main-thread work, so chrome that cannot act is
        pure cost there.
      */}
      <StatusBarScrim />
      <EdgeSwipeBack />
      <OfflineBanner />
      <ScrollPerfMonitor />
      {/* The mobile inbox's persistent top chrome (title + profile/tools +
          Stories). In the shell, above the page-transition template, so it never
          unmounts on the iOS back-swipe out of a chat — the fix for the
          long-running "stories/profile flash on swipe back". Renders only on
          /messages (mobile); see InboxMobileChrome. */}
      <InboxMobileChrome />
      <FloatingMessages />
      <Toaster />
      {/* Drops down after a follow/friend-request to offer that person's
          notifications (owner, 2026-08-24). Mounted beside Toaster because it is
          the same kind of app-wide, imperatively-raised layer. */}
      <CreatorNotifyNudgeHost />
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
      {/* App-level quick-lock PIN — gates Secret Chats and /account/security only. */}
      <PinLockGate />
    </div>
    </MotionConfig>
  );
}
