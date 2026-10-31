"use client";

import dynamic from "next/dynamic";

/**
 * Shell pieces that act only AFTER the first paint — listeners, trackers, banners and floating layers — split out
 * of every signed-in page's first load (owner, 2026-10-20: "make sure the pages are 20% lighter and faster").
 *
 * Measured before: the signed-in shell added 242 kB gz on top of the root layout, the Supabase realtime client
 * (presence, inbox badge, live toast) the largest piece. None of these draw anything a visitor sees on arrival:
 * the trackers open sockets, the layers wait for an event, the banner waits to go offline. They now load just
 * after hydration (ssr:false), so the page itself paints and responds first.
 *
 * The imperative layers (reactions, the notify nudge) keep their requests in a module store, so a request
 * raised before the host mounts is drawn the moment it does. Kept up front on purpose: the Toaster (a toast
 * fired while the page settles must show at once) and the PIN lock gate (a gate must never arrive late).
 */
const OfflineBanner = dynamic(() => import("@/features/app-shell/offline-banner").then((m) => m.OfflineBanner), { ssr: false });
const ScrollPerfMonitor = dynamic(() => import("@/features/perf/scroll-perf-monitor").then((m) => m.ScrollPerfMonitor), { ssr: false });
const FloatingMessages = dynamic(() => import("@/features/app-shell/floating-messages").then((m) => m.FloatingMessages), { ssr: false });
const CreatorNotifyNudgeHost = dynamic(() => import("@/features/social/creator-notify-nudge").then((m) => m.CreatorNotifyNudgeHost), { ssr: false });
const ReactionFloatLayer = dynamic(() => import("@/features/ui/reaction-float").then((m) => m.ReactionFloatLayer), { ssr: false });
const NotificationLiveToast = dynamic(() => import("@/features/notifications/live-toast").then((m) => m.NotificationLiveToast), { ssr: false });
const AiJobAlertMount = dynamic(() => import("@/features/ai/ai-job-alert-mount").then((m) => m.AiJobAlertMount), { ssr: false });
const PresenceTracker = dynamic(() => import("@/features/friends/use-presence").then((m) => m.PresenceTracker), { ssr: false });
const AutoAwayTracker = dynamic(() => import("@/features/friends/use-presence").then((m) => m.AutoAwayTracker), { ssr: false });
const InboxRealtimeTracker = dynamic(() => import("@/features/social/inbox").then((m) => m.InboxRealtimeTracker), { ssr: false });
const OfflineQueueSync = dynamic(() => import("@/features/app-shell/offline-queue-sync").then((m) => m.OfflineQueueSync), { ssr: false });
const ReferralClaim = dynamic(() => import("@/features/app-shell/referral-claim").then((m) => m.ReferralClaim), { ssr: false });
const DeviceCheck = dynamic(() => import("@/features/app-shell/device-check").then((m) => m.DeviceCheck), { ssr: false });
// the global top banner on the signed-in tree too — it shows only where lib/ads-platform/top-banner-pages.ts allows (Quests, Earn, Support; 2026-10-22)
const TopPageBannerAd = dynamic(() => import("@/features/monetization/top-page-banner-ad").then((m) => m.TopPageBannerAd), { ssr: false });
// a video tile opens the Reels deck in place instead of reloading /reels (owner, 2026-10-31) — features/reels/reel-open-store.ts
// coming back to the app settles a page iOS froze mid-bounce (owner, 2026-10-31)
const ResumeSettle = dynamic(() => import("@/features/app-shell/resume-settle").then((m) => m.ResumeSettle), { ssr: false });
const InPlaceReelHost = dynamic(() => import("@/features/reels/in-place-reel-host").then((m) => m.InPlaceReelHost), { ssr: false });
const VastInterstitialTriggers = dynamic(() => import("@/features/monetization/vast-interstitial/triggers").then((m) => m.VastInterstitialTriggers), { ssr: false });

export function AppShellDeferred() {
  return (
    <>
      <VastInterstitialTriggers />
      <TopPageBannerAd />
      <OfflineBanner />
      <ScrollPerfMonitor />
      <FloatingMessages />
      <CreatorNotifyNudgeHost />
      <ReactionFloatLayer />
      <NotificationLiveToast />
      <AiJobAlertMount />
      <PresenceTracker />
      <AutoAwayTracker />
      <InboxRealtimeTracker />
      <OfflineQueueSync />
      <ReferralClaim />
      <DeviceCheck />
      <InPlaceReelHost />
      <ResumeSettle />
    </>
  );
}
