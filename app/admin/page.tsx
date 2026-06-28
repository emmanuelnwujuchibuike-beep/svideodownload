import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  CalendarDays,
  Code2,
  DollarSign,
  Download,
  Gauge,
  Image as ImageIcon,
  MousePointerClick,
  Music,
  Server,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { isAdmin } from "@/lib/admin";
import {
  fetchDownloadStats,
  fetchProxyUsage,
  fetchRecentAlerts,
  maybeAlertProxyBudget,
} from "@/lib/admin-stats";
import { AdManager } from "@/features/admin/ad-manager";
import { AffiliateManager } from "@/features/admin/affiliate-manager";
import { AnalyticsPanel } from "@/features/admin/analytics-panel";
import { LimitsEditor } from "@/features/admin/limits-editor";
import { MonetizationSettings } from "@/features/admin/monetization-settings";
import { PlanManager } from "@/features/admin/plan-manager";
import { PricingEditor } from "@/features/admin/pricing-editor";
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

  const [
    proxy,
    downloads,
    alerts,
    revenue,
    subscribers,
    pricing,
    planLimits,
    monetization,
    affiliates,
    adRecords,
    analytics,
  ] = await Promise.all([
    fetchProxyUsage(),
    fetchDownloadStats(),
    fetchRecentAlerts(),
    fetchRevenueStats(),
    fetchSubscribers(),
    getPricing(),
    getPlanLimits(),
    getMonetizationSettings(),
    listAffiliates(),
    listAds(),
    fetchMonetizationAnalytics(),
  ]);
  // Fire the proxy-budget alert if we've crossed 90% (deduped to once/day).
  await maybeAlertProxyBudget(proxy);

  const emailOn = alertsEnabled();
  const total = downloads?.total ?? 0;
  const nextMilestone = (Math.floor(total / MILESTONE_EVERY) + 1) * MILESTONE_EVERY;

  const platformName = (id: string) => PLATFORMS[id as PlatformId]?.name ?? id;
  const maxPlatform = downloads?.platforms[0]?.total_downloads ?? 1;
  const kinds = downloads?.byKind ?? { video: 0, audio: 0, image: 0 };
  const kindTotal = Math.max(1, kinds.video + kinds.audio + kinds.image);

  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden container max-w-5xl pb-28 pt-32 sm:pt-40">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Admin dashboard
            </h1>
            <p className="mt-2 text-muted-foreground">
              Usage, proxy spend, and platform health at a glance.
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              emailOn
                ? "bg-green-500/12 text-green-500"
                : "bg-amber-500/12 text-amber-500",
            )}
          >
            {emailOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            {emailOn ? "Email alerts on" : "Email alerts off"}
          </span>
        </header>

        {/* Stat cards */}
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

        {/* Revenue & monetization */}
        {revenue ? (
          <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
            <h2 className="mb-5 flex items-center gap-2 font-semibold">
              <DollarSign className="h-5 w-5 text-primary" /> Revenue &amp; monetization
            </h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MiniStat
                icon={DollarSign}
                label="Est. MRR"
                value={`${revenue.currency}${formatCompactNumber(revenue.mrr)}`}
                sub={`${revenue.subscribers.total} subscribers`}
                accent
              />
              <MiniStat
                icon={Users}
                label="Pro / Business"
                value={`${formatCompactNumber(revenue.subscribers.pro)} / ${formatCompactNumber(revenue.subscribers.business)}`}
              />
              <MiniStat
                icon={Activity}
                label="Ad CTR (7d)"
                value={`${revenue.ads.ctr}%`}
                sub={`${formatCompactNumber(revenue.ads.clicks7d)} clicks`}
              />
              <MiniStat
                icon={MousePointerClick}
                label="Affiliate (today)"
                value={formatCompactNumber(revenue.affiliate.clicksToday)}
                sub={`${formatCompactNumber(revenue.affiliate.clicks7d)} this week`}
              />
              <MiniStat
                icon={Sparkles}
                label="Ad impressions today"
                value={formatCompactNumber(revenue.ads.impressionsToday)}
              />
              <MiniStat
                icon={MousePointerClick}
                label="Ad clicks today"
                value={formatCompactNumber(revenue.ads.clicksToday)}
              />
              <MiniStat
                icon={Code2}
                label="API calls today"
                value={formatCompactNumber(revenue.api.callsToday)}
                sub={`${formatCompactNumber(revenue.api.calls7d)} this week`}
              />
              <MiniStat
                icon={Code2}
                label="Active API keys"
                value={formatCompactNumber(revenue.api.activeKeys)}
              />
            </div>
          </section>
        ) : null}

        {/* Manual plan management + editable pricing + editable limits */}
        <PlanManager subscribers={subscribers} />
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

        {/* Monetization controls + managers + analytics */}
        <MonetizationSettings settings={monetization} />
        <AnalyticsPanel data={analytics} />
        <AffiliateManager affiliates={affiliates} />
        <AdManager ads={adRecords} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Proxy widget */}
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Gauge className="h-5 w-5 text-primary" /> Residential proxy
              </h2>
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
                    <p className="text-sm text-muted-foreground">
                      ~${proxy.estimatedCostUsd}
                    </p>
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
                    <p className="text-xs font-medium text-muted-foreground">
                      Bandwidth by platform
                    </p>
                    {Object.entries(proxy.perPlatform)
                      .sort((a, b) => b[1] - a[1])
                      .map(([p, bytes]) => (
                        <div key={p} className="flex justify-between text-sm">
                          <span>{platformName(p)}</span>
                          <span className="text-muted-foreground">
                            {(bytes / 1e6).toFixed(1)} MB
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                    No proxy bandwidth used yet — everything served direct. 🎉
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Proxy stats unavailable (worker unreachable or proxy not
                configured).
              </p>
            )}
          </section>

          {/* Top platforms */}
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
            <h2 className="mb-5 flex items-center gap-2 font-semibold">
              <Activity className="h-5 w-5 text-primary" /> Top platforms
            </h2>
            {downloads && downloads.platforms.length > 0 ? (
              <div className="space-y-3">
                {downloads.platforms.map((p) => (
                  <div key={p.platform}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">
                        {platformName(p.platform)}
                      </span>
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
                No downloads recorded yet. They&apos;ll appear here as people use
                the site.
              </p>
            )}
          </section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Media type breakdown */}
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
            <h2 className="mb-5 flex items-center gap-2 font-semibold">
              <Server className="h-5 w-5 text-primary" /> By media type
            </h2>
            <div className="space-y-4">
              <KindBar icon={Video} label="Video" value={kinds.video} total={kindTotal} className="from-violet-600 to-fuchsia-500" />
              <KindBar icon={Music} label="Audio" value={kinds.audio} total={kindTotal} className="from-emerald-600 to-teal-400" />
              <KindBar icon={ImageIcon} label="Photos" value={kinds.image} total={kindTotal} className="from-amber-500 to-orange-400" />
            </div>
          </section>

          {/* Alerts log */}
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Bell className="h-5 w-5 text-primary" /> Alerts
              </h2>
              <span className="text-xs text-muted-foreground">
                {emailOn ? "to your admin email" : "not configured"}
              </span>
            </div>
            {!emailOn ? (
              <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                Set <code className="font-mono">RESEND_API_KEY</code> and{" "}
                <code className="font-mono">ALERT_EMAIL_TO</code> to receive emails
                every {MILESTONE_EVERY} downloads and when proxy spend runs high.
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

        {/* Recent downloads */}
        <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 font-semibold">Recent downloads</h2>
          {downloads && downloads.recent.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {downloads.recent.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="truncate">{d.title || "Untitled"}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {platformName(d.platform)} ·{" "}
                    {new Date(d.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          )}
        </section>
      </main>
    </>
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

function MiniStat({
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
        "rounded-2xl border p-4",
        accent
          ? "border-primary/30 bg-primary/[0.04]"
          : "border-border/60 bg-secondary/25",
      )}
    >
      <Icon className={cn("h-4 w-4", accent ? "text-primary" : "text-muted-foreground")} />
      <p className="mt-2 text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">
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
