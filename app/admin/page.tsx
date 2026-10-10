import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  CalendarDays,
  Download,
  Gauge,
  Image as ImageIcon,
  Music,
  Server,
  Sparkles,
  Video,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { requireAdminPage } from "@/lib/admin/require-admin";
import {
  fetchDownloadStats,
  fetchProxyUsage,
  fetchRecentAlerts,
  maybeAlertProxyBudget,
} from "@/lib/admin-stats";
import { Suspense } from "react";

import { AdCampaignPaymentsLazy } from "@/features/admin/ad-campaign-payments-lazy";
import { AdCampaignsDeskLazy } from "@/features/admin/ad-campaigns-desk-lazy";
import { AdManager } from "@/features/admin/ad-manager";
import { AdPlatformControlsLazy } from "@/features/admin/ad-platform-controls-lazy";
import { AdSafetyCenterLazy } from "@/features/admin/ad-safety-center-lazy";
import { AdminPanel, AdminShell } from "@/features/admin/admin-shell";
import { AdminSubsections } from "@/features/admin/section-tabs";
import { SupportInbox } from "@/features/admin/support-inbox";
import { RatingsSection } from "@/features/admin/ratings-section";
import { VerificationQueue } from "@/features/admin/verification-queue";
import { WallpaperManager } from "@/features/admin/wallpaper-manager";
import { FeatureFlagManager } from "@/features/admin/feature-flags-manager";
import { ExperimentsManager } from "@/features/admin/experiments-manager";
import { getFlags } from "@/lib/platform/flags";
import { getFlagOverrides } from "@/lib/platform/flags-store";
import { getExperiments } from "@/lib/platform/experiments";
import { getExperimentOverrides, getExperimentStats } from "@/lib/platform/experiments-store";
import { DownloadAlertControls } from "@/features/admin/download-alert-settings";
import { GrowthAlertControls } from "@/features/admin/growth-alert-settings";
import { StreakMonitor } from "@/features/admin/streak-monitor";
import { getStreakMembers, getStreakMetrics } from "@/lib/streaks/admin";
import { PlatformCatalog } from "@/features/admin/platform-catalog";
import { getRegistries } from "@/lib/platform/registries";
import { getServices } from "@/lib/platform/services";
import { getEvents } from "@/lib/platform/events-registry";
import { getGates } from "@/lib/platform/governance";
import { getInfraDecisions } from "@/lib/platform/infra-decisions";
import { CommunicationCatalog } from "@/features/admin/communication-catalog";
import { getDomainEvents } from "@/lib/platform/domain-events";
import { getIntegrations } from "@/lib/platform/integration-registry";
import { DataCatalog } from "@/features/admin/data-catalog";
import { getDataDomains } from "@/lib/platform/data-domains";
import {
  getKnowledgeFabric,
  getLifecyclePolicies,
  getStorageStrategies,
} from "@/lib/platform/data-platform";
import { QualityCatalog } from "@/features/admin/quality-catalog";
import { certifyAll } from "@/lib/platform/certification";
import { getTestTypes } from "@/lib/platform/test-types";
import { ActivityFeed } from "@/features/admin/activity-feed";
import { TopDownloaders } from "@/features/admin/top-downloaders";
import { fetchActivityTotals, fetchRecentActivity } from "@/lib/admin/activity";
import { fetchTopDownloaders } from "@/lib/admin/top-downloaders";
import { ConfigCatalog } from "@/features/admin/config-catalog";
import { getConfigSurfaces } from "@/lib/platform/config-registry";
import { listConfigChanges } from "@/lib/platform/config-audit";
import { DesignCatalog } from "@/features/admin/design-catalog";
import { COMPONENT_CATEGORIES, getComponentRegistry } from "@/lib/platform/component-registry";
import { DESIGN_PRINCIPLES, getA11yStandards, getMotionPatterns, getThemes } from "@/lib/platform/design-system";
import { BRAND_TOKENS, COLOR_TOKENS } from "@/lib/platform/design-tokens";
import { EngineeringCatalog } from "@/features/admin/engineering-catalog";
import { ENGINEERING_ASSET_KINDS, getEngineeringAssets } from "@/lib/platform/engineering-registry";
import { getEngineeringStandards, STANDARD_AREAS } from "@/lib/platform/engineering-standards";
import { DiscoveryCatalog } from "@/features/admin/discovery-catalog";
import {
  getDiscoverySurfaces,
  getRankingSignals,
  getSearchableEntities,
  getSearchCapabilities,
  getSearchIndexes,
  getSeoAssets,
  SEO_ASSET_KINDS,
} from "@/lib/platform/search-platform";
import { MediaCatalog } from "@/features/admin/media-catalog";
import {
  getDeliveryCapabilities as getMediaDelivery,
  getMediaAi,
  getMediaObservability,
  getMediaServices,
  getPipelineStages,
  getStorageTiers,
  getSupportedMedia,
} from "@/lib/platform/media-platform";
import { NotificationCatalog } from "@/features/admin/notification-catalog";
import {
  getDeliveryCapabilities as getNotifDelivery,
  getNotificationAi,
  getNotificationChannels,
  getNotificationPreferences,
  getNotificationServices,
  getNotificationSources,
} from "@/lib/platform/notification-platform";
import { CommerceCatalog } from "@/features/admin/commerce-catalog";
import {
  getBillingAndPromotions,
  getCommerceAi,
  getCommerceServices,
  getCommerceTypes,
  getPaymentCapabilities,
  getSubscriptionTiers,
} from "@/lib/platform/commerce-platform";
import { GlobalizationCatalog } from "@/features/admin/globalization-catalog";
import {
  getCurrencyCapabilities,
  getGlobalizationAi,
  getGlobalizationServices,
  getLocalizationSurfaces,
  getRegionalFormats,
  getSupportedLocales,
  getTimezoneCapabilities,
} from "@/lib/platform/globalization-platform";
import { WorkspaceCatalog } from "@/features/admin/workspace-catalog";
import {
  getExtensibilityAndAi,
  getFrameworkServices,
  getLifecycleAndPlatform,
  getNavigationEngine,
  getRegisteredWorkspaces,
  getShellCapabilities,
} from "@/lib/platform/workspace-platform";
import { DigestPanel } from "@/features/admin/digest-panel";
import { AiCreationsPanel } from "@/features/admin/ai-creations-panel";
import { RevenueCharts } from "@/features/admin/revenue-charts";
import { RevenueOverview } from "@/features/admin/revenue-overview";
import { getRevenueSeries } from "@/lib/monetization/revenue-series";
import { getAnalyticsSummary, getVisitorSplitSeries } from "@/lib/analytics/queries";
import { AffiliateManager } from "@/features/admin/affiliate-manager";
import { AnalyticsPanel } from "@/features/admin/analytics-panel";
import { BroadcastComposer } from "@/features/admin/broadcast-composer";
import { LimitsEditor } from "@/features/admin/limits-editor";
import { MultiLinkEditor } from "@/features/admin/multi-link-editor";
import { MultiLinkMonitor } from "@/features/admin/multi-link-monitor";
import { RewardNetworkEditor } from "@/features/admin/reward-network-editor";
import { MessagingMonitor } from "@/features/admin/messaging-monitor";
import { MonetizationSettings } from "@/features/admin/monetization-settings";
import { PlanManager } from "@/features/admin/plan-manager";
import { AnalyticsDashboard } from "@/features/admin/analytics-dashboard";
import { DownloadHistoryPanel } from "@/features/admin/download-history-panel";
import { AnnouncementSettings } from "@/features/admin/announcement-settings";
import { PaystackSettings } from "@/features/admin/paystack-settings";
import { StatAdjuster } from "@/features/admin/stat-adjuster";
import { PricingEditor } from "@/features/admin/pricing-editor";
import { ModerationQueue } from "@/features/admin/moderation-queue";
import { SignedInUsersLazy } from "@/features/admin/signed-in-users-lazy";
import { UserModeration } from "@/features/admin/user-moderation";
import { AppealsQueue } from "@/features/admin/appeals-queue";
import { MomentumEditor } from "@/features/admin/momentum-editor";
import { PushDeliveryMonitor } from "@/features/admin/push-delivery-monitor";
import { TrendingEditor } from "@/features/admin/trending-editor";
import { listPendingAppeals } from "@/lib/social/appeals";
import { listBroadcasts } from "@/lib/social/broadcasts";
import { getTrendingSettings } from "@/lib/social/feed";
import { getMomentumSettings } from "@/lib/social/momentum";
import { fetchMessagingStats } from "@/lib/social/messaging-stats";
import { listReportedTargets } from "@/lib/social/moderation";
import { listVerificationQueue, verificationCounts } from "@/lib/social/verification";
import { listAllWallpapers } from "@/lib/wallpapers-server";
import { fetchPushDeliveryStats } from "@/lib/social/push-delivery-stats";
import { listAds } from "@/lib/monetization/ads";
import { CharacterReplaceFreeAccessPanel } from "@/features/admin/character-replace-free-access";
import { AiProvidersOverview } from "@/features/admin/ai-providers-overview";
import { FrenzAIHealth } from "@/features/admin/frenz-ai-health";
// Code-split behind a client wrapper — see features/admin/frenz-ai-settings-lazy.tsx.
import { AiBalanceAdjustLazy, AiCreditsMonitorLazy as AiCreditsMonitor, AiPlansSettingsLazy, AiShowcaseEditorLazy, AiPromoEditorLazy, AiOperationsPanelLazy, AiMoneyPanelLazy, RewardsPanelLazy, KlingPricingSettingsLazy, LipSyncSettingsLazy, TextToAudioSettingsLazy, VoiceCloneSettingsLazy, CharacterReplaceJobsTableLazy as CharacterReplaceJobsTable, CharacterReplacePricingLazy, CharacterReplaceProcessingLazy, FrenzAISettingsLazy as FrenzAISettings } from "@/features/admin/frenz-ai-settings-lazy";
import { getAiPlansAdminStats, listAiCreditMonitor } from "@/lib/ai/credits/admin";
import { loadAiProviderOverview } from "@/lib/ai/providers/overview";
import { readStoredShowcase } from "@/lib/ai/showcase/server";
import { readStoredPromo } from "@/lib/ai/promo/server";
import { getLipSyncAdminStats } from "@/lib/ai/lip-sync/admin";
import { getTextToAudioAdminStats } from "@/lib/ai/text-to-audio/admin";
import { getVoiceCloneAdminStats } from "@/lib/ai/voice-clone/admin";
import { getAiAdminStats, getCharacterReplaceFreeAccessStats, listCharacterReplaceAdminJobs } from "@/lib/ai/admin-stats";
import { loadAiMoney } from "@/lib/ai/admin-money";
import { loadPlanSurveySummary } from "@/lib/ai/credits/plan-survey-admin";
import { loadAiOperations } from "@/lib/ai/admin-ops";
import { aiCreationsOverview } from "@/lib/ai/weekly-top";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiFeature } from "@/lib/ai/jobs";
import { LandingEditor } from "@/features/admin/landing-editor";
import { PlatformStatusEditor } from "@/features/admin/platform-status-editor";
import { getPlatformStatus } from "@/lib/platform-status-store";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { getPlanLimits } from "@/lib/monetization/plan";
import { getPricing } from "@/lib/monetization/pricing";
import { getPromoSettings } from "@/lib/monetization/promo";
import { PromoEditor } from "@/features/admin/promo-editor";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import { getMultiLinkSettings } from "@/lib/downloads/multi-link";
import { getNetworkCapabilities, getRewardNetworks } from "@/lib/monetization/reward-networks-store";
import { getMultiLinkStats } from "@/lib/monetization/multilink-stats";
import { listAffiliates } from "@/lib/monetization/tools";
import {
  fetchMonetizationAnalytics,
  fetchRevenueStats,
  fetchSubscribers,
  type MonetizationAnalytics,
} from "@/lib/monetization/stats";
import { alertsEnabled } from "@/lib/notify";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatCompactNumber } from "@/lib/utils";
import type { PlatformId } from "@/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const MILESTONE_EVERY = Math.max(1, Number(process.env.ALERT_DOWNLOAD_EVERY) || 100);

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function AdminPage() {
  if (!hasSupabase) redirect("/");

  /*
    🔴 THE AUTHORIZATION DECISION FOR THIS PAGE. Not defence in depth — the
    actual gate. `middleware.ts` also checks, but middleware is a convenience
    that a matcher edit can silently remove, so this page decides for itself.

    `requireAdminPage` verifies the session against the auth server (`getUser`,
    never `getSession`) and re-reads the role from the DATABASE, so an
    administrator demoted a moment ago loses access on this very request rather
    than whenever their JWT happens to expire.
  */
  await requireAdminPage("/admin");

  /*
    Only the MONEY data is awaited before the first paint.

    This used to be one `Promise.all` over seventeen queries, so the entire
    dashboard — nav included — waited on whichever query was slowest, and the
    page appeared all at once or not at all. Everything outside the default
    section now sits behind its own `<Suspense>` in the sub-components at the
    bottom of this file, streaming in while the operator is already reading and
    able to navigate.
  */
  // the three holes are the streamed reads that left this list — see RevenueSection
  const [revenue, subscribers, pricing, planLimits, promo, monetization, affiliates, adRecords, analytics, , , , multiLink, rewardNetworks, networkCaps, multiLinkStats] =
    await Promise.all([
      fetchRevenueStats(),
      fetchSubscribers(),
      getPricing(),
      getPlanLimits(),
      getPromoSettings(),
      getMonetizationSettings(),
      listAffiliates(),
      listAds(),
      fetchMonetizationAnalytics(),
      /*
        🔴 THE THREE SLOWEST READS LEFT THIS LIST (owner, 2026-09-27: "admin
        dashboard doesn't prefetch and it takes time to load when opening",
        "the button doesn't respond immediately on click when the page just
        opened", and "visitors doesn't show until I refresh").

        Measured against production that day: analytics_traffic_totals 5.8 s,
        analytics_timeseries 4.1 s, analytics_page_traffic 4.1 s — about six
        seconds wall-clock in parallel. They sat in THIS array, so the whole
        admin page awaited them before rendering a single pixel: nothing
        painted and nothing was clickable for as long as the slowest
        analytics query took. They now stream inside RevenueSection below.
      */
      Promise.resolve(null),
      // Visitors come from the ANALYTICS summary, not the monetization one —
      // different object, and only this one carries a timeseries.
      // 90d, matching getRevenueSeries(90) above. These were 30 while the
      // revenue series was 90, so the visitor charts genuinely plotted a
      // different window from the download chart beside them (owner,
      // 2026-08-26). Both are exact aggregates over the window — see the doc
      // comment on getVisitorSplitSeries for why only the un-migrated FALLBACK
      // path stays at 30.
      Promise.resolve(null),
      Promise.resolve(null),
      // Multi-Link batch downloader policy (source ceilings, daily batches,
      // reward requirement) — a plan-limit sibling, so it sits in the same
      // Pricing & limits panel as LimitsEditor rather than a panel of its own.
      getMultiLinkSettings(),
      // Which ad network pays for which reward moment, plus the one runtime
      // fact the routing table cannot know (Offerium readiness).
      getRewardNetworks(),
      getNetworkCapabilities(),
      // Multi-Link usage, refusals, ad impressions and reward funnel. Never
      // throws — an unmigrated or unreachable table yields zeroes and the panel
      // says "nothing recorded yet" rather than breaking the dashboard.
      getMultiLinkStats(30),
    ]);

  return (
    <>
      <SiteHeader />
      {/*
        🔴 px-0 on mobile (owner, 2026-08-16: "the section cards... reach px 3
        and the section to be px-0"). `container`'s own padding (1.5rem, every
        breakpoint — tailwind.config.ts) plus every card's own p-6 was double
        padding on a small screen: 24px of page margin, THEN another 24px of
        card margin, before a single pixel of an admin control appeared. Cards
        now carry their own (smaller, `px-3`) inset, so the page itself gives
        that width back below `sm` and only restores its own padding once the
        cards have room to spare.
      */}
      <main className="relative container max-w-6xl px-0 pb-28 pt-32 sm:px-6 sm:pt-40">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4 px-3 sm:px-0">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Admin dashboard
            </h1>
            <p className="mt-2 text-muted-foreground">
              Revenue, audience and platform health.
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              alertsEnabled()
                ? "bg-green-500/12 text-green-500"
                : "bg-amber-500/12 text-amber-500",
            )}
          >
            {alertsEnabled() ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            {alertsEnabled() ? "Email alerts on" : "Email alerts off"}
          </span>
        </header>

        {/*
          The other operator pages.

          They were reachable only by typing the URL or through the command
          palette — the same defect that left /academy, /trust and /glossary
          unreachable on the public site, and it is easier to miss here because
          an operator page has no organic traffic to notice its absence.
        */}
        <nav aria-label="Operations" className="mb-10 flex flex-wrap gap-2 px-3 sm:px-0">
          {[
            { href: "/admin/corpora", label: "Corpus operations" },
            { href: "/admin/content", label: "Content operations" },
            { href: "/admin/download-hub", label: "Download Hub" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {/*
          Categorised sections. The shell renders every panel and shows one, so
          switching is instant — see features/admin/admin-shell.tsx for why that
          trade is right on an operator page and wrong on a public one.
        */}
        <AdminShell>
          {/*
            Revenue is deliberately NOT re-tabbed — it is the panel the owner
            held up as the model. The tiles answer "where are we now", the
            charts answer "how did we get here", and that is the order somebody
            reads them in, so the two stay stacked and `RevenueCharts` keeps its
            own internal tab bar over the six chart groups.
          */}
          <AdminPanel id="monetization">
            {/*
              Streams on its own: the shell, the tabs and every other panel
              are interactive while the analytics queries are still running,
              and the charts arrive when they arrive.
            */}
            <Suspense fallback={<RevenueSectionSkeleton />}>
              <RevenueSection revenue={revenue} analytics={analytics} />
            </Suspense>
            <DigestPanel />
          </AdminPanel>

          {/*
            🔴 The panel the owner named ("arrange the ad placement … with a top
            nav so i dont scroll down much"). Ad Placements used to be the LAST
            of four stacked blocks, so editing a zone meant scrolling past the
            whole monetization form, the multi-link monitor and the reward
            routing every time. Each is now one tab.
          */}
          <AdminPanel id="ads">
            <AdminSubsections
              groups={[
                { id: "placements", label: "Ad placements", content: <AdManager ads={adRecords} /> },
                /* Ad Platform Part 7: review, pause, remove and refund self-serve campaigns; advertisers. Loads when shown. */
                { id: "campaigns", label: "Campaigns", content: <AdCampaignsDeskLazy /> },
                /* Self-serve campaigns paid through Paystack/Bachs (Part 3) - loads when shown. */
                { id: "campaign-payments", label: "Campaign payments", content: <AdCampaignPaymentsLazy /> },
                /* Part 8: flags, invalid traffic, unsafe creatives and links, traffic rules. */
                { id: "traffic-safety", label: "Traffic & safety", content: <AdSafetyCenterLazy /> },
                /* Part 7: kill switch, advertiser controls, blocked links, prices, promotions. */
                { id: "self-serve-rules", label: "Self-serve rules", content: <AdPlatformControlsLazy /> },
                {
                  id: "settings",
                  label: "Ad settings",
                  /* `ads` is read only to decide which zones get a per-page
                     ExoClick switch — a zone with a row on it must be
                     switchable, not just the five built-in ones. */
                  content: <MonetizationSettings settings={monetization} ads={adRecords} />,
                },
                {
                  /* Which network pays for which reward moment. Stays in the
                     ads panel beside the network switches it routes between,
                     not in Pricing — it is an ad-delivery decision, not a plan
                     limit. */
                  id: "networks",
                  label: "Reward networks",
                  content: (
                    <RewardNetworkEditor
                      settings={rewardNetworks}
                      offeriumConfigured={networkCaps.offeriumConfigured}
                    />
                  ),
                },
                /* Usage + ad performance for the batch downloader. */
                { id: "multi-link", label: "Multi-Link", content: <MultiLinkMonitor stats={multiLinkStats} /> },
              ]}
            />
          </AdminPanel>

          <AdminPanel id="affiliates">
            <AffiliateManager affiliates={affiliates} />
          </AdminPanel>

          <AdminPanel id="pricing">
            <AdminSubsections
              groups={[
                { id: "plans", label: "Plans & pricing", content: <PricingEditor pricing={pricing} /> },
                {
                  id: "limits",
                  label: "Limits",
                  content: (
                    <LimitsEditor
                      limits={{
                        free: {
                          dailyDownloads: planLimits.free.dailyDownloads,
                          apiDailyLimit: planLimits.free.apiDailyLimit,
                        },
                        pro: {
                          dailyDownloads: planLimits.pro.dailyDownloads,
                          apiDailyLimit: planLimits.pro.apiDailyLimit,
                        },
                        business: {
                          dailyDownloads: planLimits.business.dailyDownloads,
                          apiDailyLimit: planLimits.business.apiDailyLimit,
                        },
                      }}
                    />
                  ),
                },
                { id: "multi-link", label: "Multi-Link", content: <MultiLinkEditor settings={multiLink} /> },
                { id: "promos", label: "Promo codes", content: <PromoEditor initial={promo} /> },
                /* Payment provider setup — the Paystack test/live keys. Last
                   because it is set once and then never touched, unlike the
                   four above it. */
                { id: "paystack", label: "Paystack", content: <PaystackSettings /> },
              ]}
            />
          </AdminPanel>

          <AdminPanel id="commerce">
            <CommerceCatalog
              services={getCommerceServices()}
              types={getCommerceTypes()}
              payments={getPaymentCapabilities()}
              tiers={getSubscriptionTiers()}
              billing={getBillingAndPromotions()}
              ai={getCommerceAi()}
            />
          </AdminPanel>

          <AdminPanel id="activity">
            <AdminSubsections
              groups={[
                {
                  id: "feed",
                  label: "Activity",
                  content: (
                    <Suspense fallback={<PanelSkeleton />}>
                      <ActivitySection />
                    </Suspense>
                  ),
                },
                {
                  /*
                    Owner, 2026-08-26: "give top downloader its own section and
                    a top nav in live activity for quick access." It used to sit
                    stacked above the activity feed inside "Activity" — reaching
                    it meant landing on the feed tab first. Its own tab is the
                    "quick access" ask: one tap from the Live activity top nav,
                    same mechanism every other section on this page already uses.
                  */
                  id: "top-downloaders",
                  label: "Top downloaders",
                  content: (
                    <Suspense fallback={<PanelSkeleton />}>
                      <TopDownloadersSection />
                    </Suspense>
                  ),
                },
                {
                  /* The milestone-email threshold sits with download activity,
                     which is what it counts. It loads its own state, so it
                     needs no Suspense boundary of its own. */
                  id: "alerts",
                  label: "Milestone alerts",
                  content: (
                    <>
                      <DownloadAlertControls />
                      {/* owner, 2026-09-20: the visitor and member milestones beside the download one */}
                      <GrowthAlertControls />
                    </>
                  ),
                },
              ]}
            />
          </AdminPanel>

          {/*
            Signed-in members (owner, 2026-09-27: "a place in admin dashboard
            where I can see all signed in users and detailed activities").

            A pure client island — it reads /api/admin/people on the shared
            scheduler, so there is NO server query here to hold the page up,
            and it stops polling the moment another section is opened because
            `useAdminLive` unsubscribes when its panel is hidden.
          */}
          <AdminPanel id="people">
            <SignedInUsersLazy />
          </AdminPanel>

          <AdminPanel id="subscribers">
            <PlanManager subscribers={subscribers} />
          </AdminPanel>

          {/* Streak retention. Streamed like every panel below it, so its
              handful of count queries can never hold up the figures above. */}
          <AdminPanel id="streaks">
            <Suspense fallback={<StreakMonitorSkeleton />}>
              <StreakMonitorLoader />
            </Suspense>
          </AdminPanel>

          {/*
            Everything below streams. Each panel awaits only its OWN queries, so
            a slow moderation count cannot hold up the revenue figures the
            operator opened the page for.
          */}
          <AdminPanel id="moderation">
            <AdminSubsections
              groups={[
                {
                  id: "queues",
                  label: "Queues",
                  /* The Suspense boundary stays INSIDE the group, so the queue
                     still streams independently of the panel around it. */
                  content: (
                    <Suspense fallback={<PanelSkeleton />}>
                      <ModerationSection />
                    </Suspense>
                  ),
                },
                {
                  /* Admin stat overrides — adjust a user's followers or a
                     post's likes/views (owner). A deliberate manual control,
                     and one nobody wants to scroll past to reach the queue. */
                  id: "stat-overrides",
                  label: "Stat overrides",
                  content: <StatAdjuster />,
                },
              ]}
            />
          </AdminPanel>

          {/* Support inbox — a client island that loads its own data through
              getAdminUser-guarded actions, so it needs no server-side query here. */}
          <AdminPanel id="support">
            <SupportInbox />
          </AdminPanel>

          <AdminPanel id="ratings">
            <Suspense fallback={<PanelSkeleton />}>
              <RatingsSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="verification">
            <Suspense fallback={<PanelSkeleton />}>
              <VerificationSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="wallpapers">
            <Suspense fallback={<PanelSkeleton />}>
              <WallpapersSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="trending">
            <Suspense fallback={<PanelSkeleton />}>
              <ContentSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="platform-status">
            <Suspense fallback={<PanelSkeleton />}>
              <PlatformStatusSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="landing">
            <Suspense fallback={<PanelSkeleton />}>
              <LandingSection />
            </Suspense>
          </AdminPanel>

          {/*
            🔴 Frenz AI, in the Products group rather than buried under the
            landing page. Its own panel id, so the section registry, the nav and
            the search index all agree — a section that exists in one and not
            the others is the unreachable-route defect this dashboard's registry
            was built to prevent.
          */}
          <AdminPanel id="ai">
            <Suspense fallback={<PanelSkeleton />}>
              <FrenzAISection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="discovery">
            <DiscoveryCatalog
              entities={getSearchableEntities()}
              indexes={getSearchIndexes()}
              signals={getRankingSignals()}
              seoAssets={getSeoAssets()}
              seoKinds={SEO_ASSET_KINDS}
              surfaces={getDiscoverySurfaces()}
              capabilities={getSearchCapabilities()}
            />
          </AdminPanel>

          <AdminPanel id="media">
            <MediaCatalog
              services={getMediaServices()}
              storage={getStorageTiers()}
              pipeline={getPipelineStages()}
              delivery={getMediaDelivery()}
              ai={getMediaAi()}
              observability={getMediaObservability()}
              supported={getSupportedMedia()}
            />
          </AdminPanel>

          <AdminPanel id="notifications">
            <NotificationCatalog
              services={getNotificationServices()}
              channels={getNotificationChannels()}
              sources={getNotificationSources()}
              delivery={getNotifDelivery()}
              preferences={getNotificationPreferences()}
              ai={getNotificationAi()}
            />
          </AdminPanel>

          <AdminPanel id="globalization">
            <GlobalizationCatalog
              locales={getSupportedLocales()}
              services={getGlobalizationServices()}
              formats={getRegionalFormats()}
              currency={getCurrencyCapabilities()}
              timezone={getTimezoneCapabilities()}
              surfaces={getLocalizationSurfaces()}
              ai={getGlobalizationAi()}
            />
          </AdminPanel>

          <AdminPanel id="workspaces">
            <WorkspaceCatalog
              workspaces={getRegisteredWorkspaces()}
              services={getFrameworkServices()}
              shell={getShellCapabilities()}
              navigation={getNavigationEngine()}
              lifecycle={getLifecycleAndPlatform()}
              extensibility={getExtensibilityAndAi()}
            />
          </AdminPanel>

          <AdminPanel id="flags">
            <Suspense fallback={<PanelSkeleton />}>
              <FlagsSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="experiments">
            <Suspense fallback={<PanelSkeleton />}>
              <ExperimentsSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="platform">
            <PlatformCatalog
              registries={getRegistries()}
              services={getServices()}
              events={getEvents()}
              gates={getGates()}
              decisions={getInfraDecisions()}
            />
          </AdminPanel>

          <AdminPanel id="communication">
            {/* The hand-rolled `border-t` divider goes with the stack: the tab
                bar is now what separates the two, and a rule under a tab panel
                would read as the end of the page. */}
            <AdminSubsections
              groups={[
                { id: "announcements", label: "Announcements", content: <AnnouncementSettings /> },
                {
                  id: "catalog",
                  label: "Events & integrations",
                  content: <CommunicationCatalog events={getDomainEvents()} integrations={getIntegrations()} />,
                },
              ]}
            />
          </AdminPanel>

          <AdminPanel id="data">
            <DataCatalog
              domains={getDataDomains()}
              storage={getStorageStrategies()}
              lifecycle={getLifecyclePolicies()}
              fabric={getKnowledgeFabric()}
            />
          </AdminPanel>

          <AdminPanel id="quality">
            <QualityCatalog certifications={certifyAll()} testTypes={getTestTypes()} />
          </AdminPanel>

          <AdminPanel id="config">
            <Suspense fallback={<PanelSkeleton />}>
              <ConfigSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="design">
            <DesignCatalog
              components={getComponentRegistry()}
              categories={COMPONENT_CATEGORIES}
              principles={DESIGN_PRINCIPLES}
              motionPatterns={getMotionPatterns()}
              a11yStandards={getA11yStandards()}
              themes={getThemes()}
              colorTokens={COLOR_TOKENS}
              brandTokens={BRAND_TOKENS}
            />
          </AdminPanel>

          <AdminPanel id="engineering">
            <EngineeringCatalog
              assets={getEngineeringAssets()}
              kinds={ENGINEERING_ASSET_KINDS}
              standards={getEngineeringStandards()}
              areas={STANDARD_AREAS}
            />
          </AdminPanel>

          <AdminPanel id="traffic">
            <AdminSubsections
              groups={[
                {
                  /* Live analytics dashboard (Phase 2/3) — reads the event
                     pipeline. */
                  id: "live",
                  label: "Live",
                  content: <AnalyticsDashboard />,
                },
                {
                  /* Its own tab (owner, 2026-08-25) — it used to be buried
                     partway down the live dashboard above. */
                  id: "history",
                  label: "Download history",
                  content: <DownloadHistoryPanel />,
                },
                {
                  id: "sources",
                  label: "Sources & placements",
                  content: (
            <Suspense fallback={<PanelSkeleton />}>
              {/*
                `analytics` is the SAME object Revenue's placement table reads
                (owner, 2026-08-16: "stats in revenue and stats in traffic…
                shows different stat and information"). This used to call
                `fetchMonetizationAnalytics()` a second time here — a genuinely
                separate round trip, fired at a different wall-clock moment
                than Revenue's (this panel streams in behind its own
                `&lt;Suspense&gt;`), so an ad impression or click logged in
                between the two reads could appear in one tab and not the
                other for no reason a visitor to either tab could see. Passing
                the already-awaited value down means both tabs are reading the
                literal same numbers, not two snapshots of the same query.
              */}
              <TrafficSection analytics={analytics} />
            </Suspense>
                  ),
                },
              ]}
            />
          </AdminPanel>

          <AdminPanel id="health">
            <Suspense fallback={<PanelSkeleton />}>
              <HealthSection />
            </Suspense>
          </AdminPanel>
        </AdminShell>
      </main>
    </>
  );
}

async function StreakMonitorLoader() {
  // Both reads in one round trip — the roster is a separate query from the
  // counters and there is no reason for the panel to wait on them in sequence.
  const [metrics, members] = await Promise.all([getStreakMetrics(), getStreakMembers()]);
  return <StreakMonitor metrics={metrics} members={members} />;
}

/** Matches StreakMonitor's real height, so the panel does not jump when it streams in. */
function StreakMonitorSkeleton() {
  return (
    <div className="mt-6 space-y-4 rounded-3xl border border-border/70 bg-card p-6" aria-hidden>
      <div className="h-5 w-28 animate-pulse rounded bg-secondary/60" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-secondary/40" />
        ))}
      </div>
    </div>
  );
}
/** Reserves roughly a panel's height so a streaming section does not jump. */
function PanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-28 animate-pulse rounded-2xl bg-secondary/60" />
      <div className="h-56 animate-pulse rounded-2xl bg-secondary/40" />
    </div>
  );
}

async function ModerationSection() {
  const [reportedTargets, pendingAppeals] = await Promise.all([
    listReportedTargets(),
    listPendingAppeals(),
  ]);
  return (
    <>
      <ModerationQueue targets={reportedTargets} />
      {/* Sits next to the report queue on purpose: the queue can only act on
          accounts somebody already REPORTED, which is the wrong constraint for
          a security hide the admin spots first. Same audited moderate() write
          path — this only adds reach. */}
      <UserModeration />
      <AppealsQueue appeals={pendingAppeals} />
    </>
  );
}

async function PlatformStatusSection() {
  const statuses = await getPlatformStatus();
  return <PlatformStatusEditor initial={statuses} />;
}

async function LandingSection() {
  const landing = await getLandingSettings();
  return <LandingEditor settings={landing} />;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — its own workspace at last
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "Everything related to AI functionality must live inside
 * this section… Any future AI tools should automatically belong under Frenz AI
 * instead of being added to the general dashboard."
 *
 * 🔴 These two panels were rendered by `LandingSection`, beside the hero poster
 * and the feed-grid images. Not because they belonged there — because that is
 * where the first AI switch happened to be added, and the next four followed
 * it. An operator looking for the price per AI video found it under "Landing
 * page", which is exactly the crowding the owner is describing.
 *
 * ⚠️ Both still read `getLandingSettings()`, and that is deliberate: the AI
 * fields live in the same `settings` row, and splitting the STORE to match a
 * change in the NAV would be rewriting working backend logic to satisfy an
 * information-architecture decision — which the brief explicitly rules out.
 * Two reads of one cached settings object is the correct cost.
 *
 * They stay separate FORMS for the reason recorded in frenz-ai-settings.tsx:
 * each POSTs only the fields it displays, so neither can clobber the other's.
 */
/** The video provider's state for the overview card: the worst of its tools' health (§9 — never green on no data). */
function klingStateOf(o: { features: { vendor: string; state: "healthy" | "degraded" | "unavailable" | "unknown" }[] }): "healthy" | "degraded" | "unavailable" | "unknown" {
  const states = o.features.filter((f) => f.vendor === "kling").map((f) => f.state);
  for (const s of ["unavailable", "degraded", "healthy"] as const) if (states.includes(s)) return s;
  return "unknown";
}

async function FrenzAISection() {
  const [landing, aiStats, crJobs, aiOps, aiCreations] = await Promise.all([
    getLandingSettings(),
    getAiAdminStats(),
    listCharacterReplaceAdminJobs(60),
    // Part 8 §7, §35–§39: every tool's jobs, one bounded read (lib/ai/admin-ops.ts)
    loadAiOperations(),
    // 2026-10-10: creations by kind, top 10 creators, weekly prizes (lib/ai/weekly-top.ts)
    aiCreationsOverview(createAdminClient()).catch(() => null),
  ]);
  const aiOpsLabels = Object.fromEntries([...new Set(aiOps.jobs.map((j) => j.feature))].map((f) => [f, aiFeature(f)?.label ?? f]));
  // Part 11 §19: the complimentary-creation figures, beside the health panel
  const freeStats = await getCharacterReplaceFreeAccessStats(landing.frenzAiCurrency);
  // 0167: the AI plans' usage and figures (read once, rendered under their own tab)
  // Part 8 (2026-10-05): the Replicate / fal.ai switchboard, its 200-row run
  // ledger read, the dead circuit-breaker rows and the Character Replace audit
  // trail (three loaders) are replaced by ONE bounded ai_jobs read.
  const [creditRows, planStats, providerOverview, lipSyncStats, textToAudioStats, voiceCloneStats, showcase, promo, aiMoney, planSurvey] = await Promise.all([listAiCreditMonitor(150).catch(() => []), getAiPlansAdminStats(landing.frenzAiPlans, landing.frenzAiCurrency).catch(() => null), loadAiProviderOverview(landing.frenzAiProviders.adminJobsAreTests), getLipSyncAdminStats(landing.frenzAiCurrency).catch(() => null), getTextToAudioAdminStats(landing.frenzAiCurrency).catch(() => null), getVoiceCloneAdminStats(landing.frenzAiCurrency).catch(() => null), readStoredShowcase(), readStoredPromo(), loadAiMoney(landing.frenzAiPlans.credits.centsPerCredit), loadPlanSurveySummary().catch(() => null)]);
  const moneyLabels: Record<string, string> = { text_to_video: "Text to Video", image_to_video: "Image to Video", lip_sync: "Lip Sync", text_to_audio: "Text to Audio", voice_clone: "Voice Cloning", character_replace: "Character Replace", ai_pro: landing.frenzAiPlans.plans.ai_pro.label, ai_max: landing.frenzAiPlans.plans.ai_max.label, pro: "Frenzsave Pro", business: "Frenzsave Business", ...aiOpsLabels };

  /*
    Owner, 2026-09-14: "put all the Frenz AI sections below the Frenz AI tab in
    the admin dashboard in horizontal NAV and button for each section so when
    I enter the Frenz AI I don't need to scroll down before seeing what am
    looking for." One tab per panel; the inactive ones are unmounted, so a
    panel's chunk is fetched the first time its tab is opened.
  */
  return (
    <AdminSubsections
      unmountInactive
      groups={[
        {
          id: "health",
          label: "Overview",
          content: (
            <div className="space-y-6">
              <FrenzAIHealth stats={aiStats} />
              {aiCreations ? <AiCreationsPanel data={aiCreations} labels={Object.fromEntries([...new Set([...aiCreations.recent.map((r) => r.feature)])].map((f) => [f, aiFeature(f)?.label ?? f]))} /> : null}
              {/* Part 8 §7/§62, §35–§39 (2026-10-07): every tool's jobs, failures grouped and split by owner. */}
              <AiOperationsPanelLazy ops={aiOps} labels={aiOpsLabels} kling={klingStateOf(providerOverview)} currencySymbol={aiCurrencySymbol(landing.frenzAiCurrency)} />
              <AiMoneyPanelLazy money={aiMoney} labels={moneyLabels} survey={planSurvey} />
              <CharacterReplaceFreeAccessPanel stats={freeStats} symbol={aiCurrencySymbol(landing.frenzAiCurrency)} />
            </div>
          ),
        },
        {
          id: "pricing",
          label: "Character Replace (retired)",
          content: (
            <div className="space-y-6">
              <CharacterReplacePricingLazy settings={landing} />
              {/* Moved from Overview 2026-10-07: the retired tool's own job history. Live tools are in the operations panel. */}
              <CharacterReplaceJobsTable jobs={crJobs} symbol={aiCurrencySymbol(landing.frenzAiCurrency)} />
            </div>
          ),
        },
        /* 0166 (multi-video brief §16): concurrency per plan, the queue, batch size, retries, timeout, the failed-job refund. */
        { id: "processing", label: "Processing", content: <CharacterReplaceProcessingLazy settings={landing} /> },
        /* Lip Sync Pro (2026-09-21): the provider switch (Replicate | fal.ai Sync-3), the models, text and audio modes, limits, presets, the mismatch policy, the prices, the numbers. */
        {
          id: "lipsync",
          label: "Lip Sync",
          content: <LipSyncSettingsLazy settings={landing} stats={lipSyncStats} voices={landing.frenzAiCharacterReplace.voices.map((v) => ({ id: v.id, label: v.label, provider: v.provider }))} languages={landing.frenzAiCharacterReplace.languages.map((l) => ({ code: l.code, label: l.label }))} />,
        },
        /* Text to Audio (2026-09-21): the route switch (direct ElevenLabs API | Replicate), the model, the prices, the 500 free characters a month, the Audio Library numbers. */
        {
          id: "textaudio",
          label: "Text to Audio",
          content: <TextToAudioSettingsLazy settings={landing} stats={textToAudioStats} voices={landing.frenzAiCharacterReplace.voices.map((v) => ({ id: v.id, label: v.label, provider: v.provider }))} languages={landing.frenzAiCharacterReplace.languages.map((l) => ({ code: l.code, label: l.label }))} />,
        },
        /* Kling pricing (2026-09-28, Part 4 §12–§14): the per-tier matrix. Kling charges in UNITS reported on each task; what a member pays is a separate figure. Tiers whose provider cost has not been measured say so instead of showing a margin. */
        { id: "klingpricing", label: "Kling pricing", content: <KlingPricingSettingsLazy settings={landing} /> },
        /* Voice Cloning (2026-09-27): the voice slots (the thing that actually runs out), the price per voice, the recording limits, the rights confirmation, the live-voice figures. */
        { id: "voiceclone", label: "Voice Cloning", content: <VoiceCloneSettingsLazy settings={landing} stats={voiceCloneStats} /> },
        /* 0167: AI Pro / AI Max, the one-time creations per site plan, the credit rules — and who spent what. */
        {
          id: "plans",
          label: "AI Plans & Credits",
          content: (
            <div className="space-y-6">
              <AiPlansSettingsLazy settings={landing} />
              <AiCreditsMonitor rows={creditRows} stats={planStats} symbol={aiCurrencySymbol(landing.frenzAiCurrency)} />
            </div>
          ),
        },
        /* Part 8 (2026-10-05): READ-ONLY — Video → Kling, Audio → ElevenLabs, health from real jobs. The Replicate / fal.ai switchboard is gone and the server refuses its settings. */
        {
          id: "providers",
          label: "Providers",
          content: (
            <AiProvidersOverview overview={providerOverview} />
          ),
        },
        /* Rewards brief part 1 (2026-10-07): one reward engine, referrals, usable vs withdrawable credits, manual withdrawals. */
        { id: "rewards", label: "Rewards & referrals", content: <RewardsPanelLazy settings={landing} /> },
        { id: "balances", label: "Member balances", content: <AiBalanceAdjustLazy settings={landing} /> },
        { id: "access", label: "Access & allowances", content: <FrenzAISettings settings={landing} /> },
        /* Redesign Phase 1 (2026-10-05): the welcome page carousel — image, chip, title, highlight, description, link, order, on/off, with the real card as preview. */
        { id: "showcase", label: "Welcome showcase", content: <AiShowcaseEditorLazy initial={showcase} /> },
        { id: "promo", label: "Landing promotion", content: <AiPromoEditorLazy initial={promo} /> },
      ]}
    />
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REVENUE & ENGAGEMENT — streamed, because its queries are seconds long
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "When I enter the admin dashboard, visitors doesn't show
 * until I refresh that's when it shows."
 *
 * 🔴 IT WAS NOT A CACHE — IT WAS A SWALLOWED FAILURE. getAnalyticsSummary
 * catches everything and returns a fully zero-filled summary ("tables not
 * migrated yet, or a transient error"), so a slow or failed read does not look
 * like an error: it looks like a real answer that happens to be zero. That is
 * why the chart read "0 in the last 90 days" beside a New-visitors chart with
 * 3,174 in it — the second comes from a different call, which had succeeded.
 *
 * Two things follow. The reads are awaited HERE, so the rest of the dashboard
 * no longer waits ~6 s for them. And when the summary comes back with
 * exactAggregates:false the panel SAYS the figures could not be read, instead
 * of drawing a flat zero line and letting an operator believe it.
 */
async function RevenueSection({
  revenue,
  analytics,
}: {
  revenue: Awaited<ReturnType<typeof fetchRevenueStats>>;
  analytics: Awaited<ReturnType<typeof fetchMonetizationAnalytics>>;
}) {
  const [revenueSeries, visitorSummary, visitorSplit] = await Promise.all([
    getRevenueSeries(90),
    getAnalyticsSummary("90d").catch(() => null),
    getVisitorSplitSeries(90).catch(() => null),
  ]);
  // The summary's own health flag: false means the numbers below are not real.
  const unavailable = !visitorSummary || visitorSummary.rpcHealth.exactAggregates === false;
  return (
    <>
      <RevenueOverview
        revenue={revenue}
        analytics={analytics}
        traffic={
          visitorSummary && !unavailable
            ? {
                pageViews: visitorSummary.pageViews,
                uniqueVisitors: visitorSummary.uniqueVisitors,
                cpmUsd: visitorSummary.ads.cpmUsd,
                adRevenueUsd: visitorSummary.ads.revenueUsd,
                series: visitorSummary.timeseries.buckets.map((b) => ({ date: b.t.slice(0, 10), pageViews: b.pageViews })),
              }
            : null
        }
      />
      {unavailable ? (
        <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
          Visitor figures could not be read just now{visitorSummary?.rpcHealth.note ? ` — ${visitorSummary.rpcHealth.note}` : ""}. Reload to try again — they are not zero, they are unknown.
        </p>
      ) : null}
      <RevenueCharts
        series={revenueSeries}
        mrr={revenue?.mrr ?? 0}
        currency={revenue?.currency ?? "$"}
        mrrComplete={revenue?.mrrComplete ?? true}
        visitors={unavailable ? undefined : visitorSummary?.timeseries.buckets.map((b) => ({ date: b.t.slice(0, 10), visitors: b.visitors }))}
        visitorSplit={visitorSplit?.days}
      />
      <DigestPanel />
    </>
  );
}

/*
  🔴 `bg-secondary`, NOT `bg-card` (owner, 2026-09-27: "Sections in the admin
  dashboard doesn't load or takes time to load, it shows white").

  `bg-card` IS white on the light theme, so this was a white card pulsing on a
  white page — an animation with nothing to animate against. For the twelve
  seconds the 90-day aggregates were taking, the section was indistinguishable
  from a blank one that had failed.

  `PanelSkeleton` above already uses `bg-secondary`, which is what makes its
  pulse legible; this now matches. The speed itself is fixed separately, in
  migration 0177 — but a slow section must still LOOK like it is arriving.
*/
function RevenueSectionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading revenue and engagement">
      <div className="h-32 animate-pulse rounded-2xl bg-secondary/60" />
      <div className="h-80 animate-pulse rounded-2xl bg-secondary/40" />
    </div>
  );
}

async function WallpapersSection() {
  const wallpapers = await listAllWallpapers();
  return <WallpaperManager wallpapers={wallpapers} />;
}

async function VerificationSection() {
  const [queue, counts] = await Promise.all([listVerificationQueue(), verificationCounts()]);
  return <VerificationQueue queue={queue} counts={counts} />;
}

async function ContentSection() {
  const [trendingSettings, momentumSettings, broadcasts] = await Promise.all([
    getTrendingSettings(),
    getMomentumSettings(),
    listBroadcasts(),
  ]);
  return (
    <>
      <TrendingEditor settings={trendingSettings} />
      <MomentumEditor settings={momentumSettings} />
      <BroadcastComposer initialBroadcasts={broadcasts} />
    </>
  );
}

async function ActivitySection() {
  const [initial, totals] = await Promise.all([fetchRecentActivity(40), fetchActivityTotals()]);
  return <ActivityFeed initial={initial} totals={totals} />;
}

/** Split out of ActivitySection so it streams on its own tab — see the
 *  "top-downloaders" group above. */
async function TopDownloadersSection() {
  const topDownloaders = await fetchTopDownloaders();
  return <TopDownloaders data={topDownloaders} />;
}

async function ConfigSection() {
  const changes = await listConfigChanges(50);
  return <ConfigCatalog surfaces={getConfigSurfaces()} changes={changes} />;
}

async function FlagsSection() {
  const overrides = await getFlagOverrides();
  const flags = getFlags().map((f) => {
    const o = overrides[f.id];
    return {
      id: f.id,
      label: f.label,
      description: f.description,
      category: f.category,
      defaultEnabled: f.defaultEnabled,
      rollout: f.rollout ?? null,
      plans: f.plans ?? null,
      adminBypass: !!f.adminBypass,
      consumer: f.consumer,
      override: { enabled: o?.enabled ?? null, rolloutPercentage: o?.rolloutPercentage ?? null },
    };
  });
  return <FeatureFlagManager flags={flags} />;
}

async function ExperimentsSection() {
  const [overrides, stats] = await Promise.all([getExperimentOverrides(), getExperimentStats()]);
  const experiments = getExperiments().map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
    status: e.status,
    variants: e.variants,
    plans: e.plans ?? null,
    override: {
      paused: overrides[e.id]?.paused ?? null,
      forceVariant: overrides[e.id]?.forceVariant ?? null,
    },
    exposures: stats[e.id] ?? {},
  }));
  return <ExperimentsManager experiments={experiments} />;
}

async function TrafficSection({ analytics }: { analytics: MonetizationAnalytics | null }) {
  const downloads = await fetchDownloadStats();

  const total = downloads?.total ?? 0;
  const nextMilestone = (Math.floor(total / MILESTONE_EVERY) + 1) * MILESTONE_EVERY;
  const platformName = (id: string) => PLATFORMS[id as PlatformId]?.name ?? id;
  const maxPlatform = downloads?.platforms[0]?.total_downloads ?? 1;
  const kinds = downloads?.byKind ?? { video: 0, audio: 0, image: 0 };
  const kindTotal = Math.max(1, kinds.video + kinds.audio + kinds.image);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Download}
          label="Total downloads"
          value={downloads ? formatCompactNumber(downloads.total) : "—"}
          accent
        />
        <StatCard
          icon={Sparkles}
          label="Today"
          value={downloads ? formatCompactNumber(downloads.today) : "—"}
        />
        <StatCard
          icon={CalendarDays}
          label="Last 7 days"
          value={downloads ? formatCompactNumber(downloads.last7) : "—"}
        />
        <StatCard
          icon={Bell}
          label="Next email alert"
          value={downloads ? formatCompactNumber(nextMilestone) : "—"}
          sub={`every ${MILESTONE_EVERY}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
          <h3 className="mb-5 flex items-center gap-2 font-semibold">
            <Activity className="h-5 w-5 text-primary" /> Top platforms
          </h3>
          {downloads && downloads.platforms.length > 0 ? (
            <div className="space-y-3">
              {downloads.platforms.map((p) => (
                <div key={p.platform}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{platformName(p.platform)}</span>
                    <span className="text-muted-foreground">
                      {formatCompactNumber(p.total_downloads)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{
                        width: `${Math.max(4, (p.total_downloads / maxPlatform) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No downloads recorded yet. They will appear here as people use the site.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
          <h3 className="mb-5 flex items-center gap-2 font-semibold">
            <Server className="h-5 w-5 text-primary" /> By media type
          </h3>
          <div className="space-y-4">
            <KindBar icon={Video} label="Video" value={kinds.video} total={kindTotal} className="from-violet-600 to-fuchsia-500" />
            <KindBar icon={Music} label="Audio" value={kinds.audio} total={kindTotal} className="from-emerald-600 to-teal-400" />
            <KindBar icon={ImageIcon} label="Photos" value={kinds.image} total={kindTotal} className="from-amber-500 to-orange-400" />
          </div>
        </section>
      </div>

      <AnalyticsPanel data={analytics} />

      <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 font-semibold">Recent downloads</h3>
        {downloads && downloads.recent.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {downloads.recent.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="truncate">{d.title || "Untitled"}</span>
                <span className="shrink-0 text-muted-foreground">
                  {platformName(d.platform)} · {new Date(d.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        )}
      </section>
    </div>
  );
}

async function HealthSection() {
  const [proxy, alerts, messagingStats, pushDeliveryStats, downloads] = await Promise.all([
    fetchProxyUsage(),
    fetchRecentAlerts(),
    fetchMessagingStats(),
    fetchPushDeliveryStats(),
    fetchDownloadStats(),
  ]);
  // Fire the proxy-budget alert if we have crossed 90% (deduped to once/day).
  await maybeAlertProxyBudget(proxy);

  const emailOn = alertsEnabled();
  const total = downloads?.total ?? 0;
  const nextMilestone = (Math.floor(total / MILESTONE_EVERY) + 1) * MILESTONE_EVERY;
  const platformName = (id: string) => PLATFORMS[id as PlatformId]?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <Gauge className="h-5 w-5 text-primary" /> Residential proxy
            </h3>
            {proxy && proxy.alertLevel >= 75 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  proxy.alertLevel >= 90
                    ? "bg-red-500/15 text-red-500"
                    : "bg-amber-500/15 text-amber-500",
                )}
              >
                <AlertTriangle className="h-3 w-3" /> {proxy.alertLevel}% of budget
              </span>
            ) : null}
          </div>

          {proxy ? (
            <>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-semibold">
                  {proxy.gbThisMonth}
                  <span className="text-base font-normal text-muted-foreground">
                    {" "}
                    / {proxy.limitGb} GB
                  </span>
                </p>
                {proxy.estimatedCostUsd != null ? (
                  <p className="text-sm text-muted-foreground">~${proxy.estimatedCostUsd}</p>
                ) : null}
              </div>

              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    proxy.alertLevel >= 90
                      ? "bg-red-500"
                      : proxy.alertLevel >= 75
                        ? "bg-amber-500"
                        : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, proxy.percentOfLimit)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {proxy.remainingGb} GB remaining · {proxy.percentOfLimit}% used ·{" "}
                {formatCompactNumber(proxy.requests.proxy)} proxied /{" "}
                {formatCompactNumber(proxy.requests.direct)} direct
              </p>

              {Object.keys(proxy.perPlatform).length > 0 ? (
                <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
                  <p className="text-xs font-medium text-muted-foreground">Bandwidth by platform</p>
                  {Object.entries(proxy.perPlatform)
                    .sort((a, b) => b[1] - a[1])
                    .map(([p, bytes]) => (
                      <div key={p} className="flex justify-between text-sm">
                        <span>{platformName(p)}</span>
                        <span className="text-muted-foreground">{(bytes / 1e6).toFixed(1)} MB</span>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                  No proxy bandwidth used yet — everything served direct.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Proxy stats unavailable (worker unreachable or proxy not configured).
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <Bell className="h-5 w-5 text-primary" /> Alerts
            </h3>
            <span className="text-xs text-muted-foreground">
              {emailOn ? "to your admin email" : "not configured"}
            </span>
          </div>
          {!emailOn ? (
            <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              Set <code className="font-mono">RESEND_API_KEY</code> and{" "}
              <code className="font-mono">ALERT_EMAIL_TO</code> to receive emails every{" "}
              {MILESTONE_EVERY} downloads and when proxy spend runs high.
            </p>
          ) : alerts.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertDot kind={a.kind} />
                    <span className="truncate">{a.subject ?? a.kind}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No alerts sent yet. Your first email arrives at{" "}
              {formatCompactNumber(nextMilestone)} downloads.
            </p>
          )}
        </section>
      </div>

      <MessagingMonitor stats={messagingStats} />
      <PushDeliveryMonitor stats={pushDeliveryStats} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Download;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-soft transition-shadow hover:shadow-card",
        accent
          ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15"
          : "border-border/70",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl",
          accent ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {label}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}

function KindBar({
  icon: Icon,
  label,
  value,
  total,
  className,
}: {
  icon: typeof Video;
  label: string;
  value: number;
  total: number;
  className: string;
}) {
  const pct = Math.round((value / total) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" /> {label}
        </span>
        <span className="text-muted-foreground">
          {formatCompactNumber(value)} · {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r", className)}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function AlertDot({ kind }: { kind: string }) {
  const color =
    kind === "proxy_budget"
      ? "bg-amber-500"
      : kind === "download_milestone" || kind === "visitor_milestone" || kind === "user_milestone"
        ? "bg-green-500"
        : "bg-primary";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />;
}
