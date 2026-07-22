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
import { isAdmin } from "@/lib/admin";
import {
  fetchDownloadStats,
  fetchProxyUsage,
  fetchRecentAlerts,
  maybeAlertProxyBudget,
} from "@/lib/admin-stats";
import { Suspense } from "react";

import { AdManager } from "@/features/admin/ad-manager";
import { AdminPanel, AdminShell } from "@/features/admin/admin-shell";
import { FeatureFlagManager } from "@/features/admin/feature-flags-manager";
import { ExperimentsManager } from "@/features/admin/experiments-manager";
import { getFlags } from "@/lib/platform/flags";
import { getFlagOverrides } from "@/lib/platform/flags-store";
import { getExperiments } from "@/lib/platform/experiments";
import { getExperimentOverrides, getExperimentStats } from "@/lib/platform/experiments-store";
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
import { RevenueOverview } from "@/features/admin/revenue-overview";
import { AffiliateManager } from "@/features/admin/affiliate-manager";
import { AnalyticsPanel } from "@/features/admin/analytics-panel";
import { BroadcastComposer } from "@/features/admin/broadcast-composer";
import { LimitsEditor } from "@/features/admin/limits-editor";
import { MessagingMonitor } from "@/features/admin/messaging-monitor";
import { MonetizationSettings } from "@/features/admin/monetization-settings";
import { PlanManager } from "@/features/admin/plan-manager";
import { PricingEditor } from "@/features/admin/pricing-editor";
import { ModerationQueue } from "@/features/admin/moderation-queue";
import { UserModeration } from "@/features/admin/user-moderation";
import { AppealsQueue } from "@/features/admin/appeals-queue";
import { PushDeliveryMonitor } from "@/features/admin/push-delivery-monitor";
import { TrendingEditor } from "@/features/admin/trending-editor";
import { listPendingAppeals } from "@/lib/social/appeals";
import { listBroadcasts } from "@/lib/social/broadcasts";
import { getTrendingSettings } from "@/lib/social/feed";
import { fetchMessagingStats } from "@/lib/social/messaging-stats";
import { listReportedTargets } from "@/lib/social/moderation";
import { fetchPushDeliveryStats } from "@/lib/social/push-delivery-stats";
import { listAds } from "@/lib/monetization/ads";
import { getPlanLimits } from "@/lib/monetization/plan";
import { getPricing } from "@/lib/monetization/pricing";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import { listAffiliates } from "@/lib/monetization/tools";
import {
  fetchMonetizationAnalytics,
  fetchRevenueStats,
  fetchSubscribers,
} from "@/lib/monetization/stats";
import { alertsEnabled } from "@/lib/notify";
import { PLATFORMS } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";
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
  if (!hasSupabase) redirect("/login");

  // Defense-in-depth (middleware already guards this).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdmin(profile?.role, user.email)) redirect("/");

  /*
    Only the MONEY data is awaited before the first paint.

    This used to be one `Promise.all` over seventeen queries, so the entire
    dashboard — nav included — waited on whichever query was slowest, and the
    page appeared all at once or not at all. Everything outside the default
    section now sits behind its own `<Suspense>` in the sub-components at the
    bottom of this file, streaming in while the operator is already reading and
    able to navigate.
  */
  const [revenue, subscribers, pricing, planLimits, monetization, affiliates, adRecords, analytics] =
    await Promise.all([
      fetchRevenueStats(),
      fetchSubscribers(),
      getPricing(),
      getPlanLimits(),
      getMonetizationSettings(),
      listAffiliates(),
      listAds(),
      fetchMonetizationAnalytics(),
    ]);

  return (
    <>
      <SiteHeader />
      <main className="relative container max-w-6xl pb-28 pt-32 sm:pt-40">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
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
        <nav aria-label="Operations" className="mb-10 flex flex-wrap gap-2">
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
          <AdminPanel id="monetization">
            <RevenueOverview revenue={revenue} analytics={analytics} />
          </AdminPanel>

          <AdminPanel id="ads">
            <MonetizationSettings settings={monetization} />
            <AdManager ads={adRecords} />
          </AdminPanel>

          <AdminPanel id="affiliates">
            <AffiliateManager affiliates={affiliates} />
          </AdminPanel>

          <AdminPanel id="pricing">
            <PricingEditor pricing={pricing} />
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
          </AdminPanel>

          <AdminPanel id="subscribers">
            <PlanManager subscribers={subscribers} />
          </AdminPanel>

          {/*
            Everything below streams. Each panel awaits only its OWN queries, so
            a slow moderation count cannot hold up the revenue figures the
            operator opened the page for.
          */}
          <AdminPanel id="moderation">
            <Suspense fallback={<PanelSkeleton />}>
              <ModerationSection />
            </Suspense>
          </AdminPanel>

          <AdminPanel id="trending">
            <Suspense fallback={<PanelSkeleton />}>
              <ContentSection />
            </Suspense>
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
            <CommunicationCatalog events={getDomainEvents()} integrations={getIntegrations()} />
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

          <AdminPanel id="traffic">
            <Suspense fallback={<PanelSkeleton />}>
              <TrafficSection />
            </Suspense>
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

async function ContentSection() {
  const [trendingSettings, broadcasts] = await Promise.all([
    getTrendingSettings(),
    listBroadcasts(),
  ]);
  return (
    <>
      <TrendingEditor settings={trendingSettings} />
      <BroadcastComposer initialBroadcasts={broadcasts} />
    </>
  );
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

async function TrafficSection() {
  const [downloads, analytics] = await Promise.all([
    fetchDownloadStats(),
    fetchMonetizationAnalytics(),
  ]);

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
      : kind === "download_milestone"
        ? "bg-green-500"
        : "bg-primary";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />;
}
