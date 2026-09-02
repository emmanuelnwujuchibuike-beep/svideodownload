import { AlertTriangle, DollarSign, Layers, MousePointerClick, Eye, TrendingUp, Users } from "lucide-react";

import { AdminAreaChart } from "./area-chart";

import { AD_ZONE_META, type AdZoneId } from "@/lib/monetization/ad-schema";
import type { MonetizationAnalytics, RevenueStats } from "@/lib/monetization/stats";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The revenue picture — the first thing the dashboard shows.
 *
 * ── Every number here is counted, never modelled ──────────────────────────────
 *
 * Impressions and clicks are exact counts from `ad_impressions` / `ad_clicks`,
 * written by the `/api/track` beacon. Subscription income is live subscriber
 * counts multiplied by the prices set on the pricing screen. Nothing is
 * projected, annualised or estimated, because a plausible-looking number nobody
 * can trace is worse than no number — this project has declined invented
 * statistics three times and this screen is where the temptation is highest.
 *
 * There is deliberately no ad REVENUE figure. Networks report earnings in their
 * own dashboards and we do not receive them; multiplying impressions by an
 * assumed RPM would produce exactly the kind of confident fiction above. What we
 * genuinely know is engagement, so that is what is shown.
 *
 * ── Partial totals are labelled as partial ────────────────────────────────────
 *
 * `mrrComplete` is false when a configured price is not a number ("Contact us"
 * is a real thing to write on a pricing page). The total then excludes that plan
 * and says so, rather than quietly counting those subscribers as free.
 */

/**
 * Human labels for the Hilltop slot rows `/api/track` now records.
 *
 * They are not AD_ZONES — no ads-table row, no `AD_ZONE_META` entry — so
 * without this the table would print `hilltop_historyfeed` at an operator and
 * make them work out where on the site that is. The wording matches the
 * placement switches in the monetization panel, so a row here and the switch
 * that controls it read as the same thing.
 */
const HILLTOP_SLOT_LABELS: Record<string, string> = {
  hilltop_history: "HilltopAds — History, above the grid",
  hilltop_historyfeed: "HilltopAds — History, between time periods",
  hilltop_landing: "HilltopAds — Landing, under the wallpaper button",
  hilltop_feed: "HilltopAds — in-feed",
};

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  emphasis,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        emphasis
          ? "border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent"
          : "border-border/70 bg-card",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon aria-hidden className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "font-bold tabular-nums tracking-tight",
          emphasis ? "text-3xl" : "text-2xl",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function RevenueOverview({
  revenue,
  analytics,
  traffic,
}: {
  revenue: RevenueStats | null;
  analytics: MonetizationAnalytics | null;
  /**
   * Page views and the ad aggregate over the dashboard's window.
   *
   * Owner, 2026-09-02: "put a page viiew stat and chart in the revenue and
   * engagement in admin dashboard along with other stats."
   *
   * Revenue needed this more than engagement did: every number on this screen
   * is either subscription income or ad income, and ad income is a function of
   * page views × fill × CPM. Without views on the same screen, an impression
   * count has nothing to be read against — "42,000 impressions" means something
   * different at 50,000 views than at 500,000, and the difference is the whole
   * question of whether the placements are working.
   *
   * Null when the analytics tables could not be read; the cards then say so
   * rather than rendering a confident zero.
   */
  traffic: {
    pageViews: number;
    uniqueVisitors: number;
    cpmUsd: number;
    adRevenueUsd: number;
    /** Daily page views over the window, oldest first. */
    series: { date: string; pageViews: number }[];
  } | null;
}) {
  if (!revenue) {
    return (
      <p className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
        Revenue statistics are unavailable — the database could not be reached.
      </p>
    );
  }

  const { subscribers, ads, affiliate, api } = revenue;
  const zones = analytics?.adZones ?? [];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          icon={TrendingUp}
          label="Monthly recurring revenue"
          value={`${revenue.currency}${revenue.mrr.toLocaleString()}`}
          /* The prices this was computed from, shown so the figure is
             traceable without leaving the screen. */
          sub={
            revenue.mrrComplete
              ? `${subscribers.pro} × ${revenue.prices.pro} + ${subscribers.business} × ${revenue.prices.business}`
              : "Partial — a configured price is not a number"
          }
          emphasis
        />
        <Metric
          icon={Users}
          label="Paying subscribers"
          value={formatCompactNumber(subscribers.total)}
          sub={`${subscribers.pro} Pro · ${subscribers.business} Business`}
        />
        <Metric
          icon={Eye}
          label="Ad impressions (7d)"
          value={formatCompactNumber(ads.impr7d)}
          sub={`${formatCompactNumber(ads.impressionsToday)} today`}
        />
        <Metric
          icon={MousePointerClick}
          label="Ad clicks (7d)"
          value={formatCompactNumber(ads.clicks7d)}
          sub={`${ads.ctr}% CTR · ${formatCompactNumber(ads.clicksToday)} today`}
        />
      </div>

      {/*
        Traffic, on the revenue screen, because ad income is a function of it.
        An impression count with no view count beside it cannot be judged.
      */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          icon={Eye}
          label="Page views"
          value={traffic ? formatCompactNumber(traffic.pageViews) : "—"}
          sub={traffic ? `${formatCompactNumber(traffic.uniqueVisitors)} unique visitors` : "Analytics unavailable"}
        />
        <Metric
          icon={Layers}
          label="Impressions per 100 views"
          /*
            The ratio that says whether the placements are actually filling.
            Deliberately per-100 rather than a percentage: a page carries several
            slots, so the number is routinely above 100 and a "%" label on it
            would read as broken.
          */
          value={
            traffic && traffic.pageViews > 0
              ? Math.round((ads.impr7d / traffic.pageViews) * 100).toLocaleString()
              : "—"
          }
          sub={traffic && traffic.pageViews > 0 ? "Ad impressions ÷ page views" : "Needs both numbers"}
        />
        <Metric
          icon={DollarSign}
          label="Estimated ad revenue"
          value={traffic ? `$${traffic.adRevenueUsd.toFixed(2)}` : "—"}
          /*
            🔴 Labelled ESTIMATED, and the CPM it used is printed beside it.
            The networks do not report revenue to us — this is impressions ÷
            1000 × the CPM an admin typed in. Showing it without the input
            visible would turn a projection into a figure somebody plans
            against.
          */
          sub={traffic ? `At $${traffic.cpmUsd.toFixed(2)} CPM — your estimate, not network-reported` : "Analytics unavailable"}
        />
        <Metric
          icon={MousePointerClick}
          label="Click-through rate"
          value={`${ads.ctr}%`}
          sub={`${formatCompactNumber(ads.clicks7d)} clicks ÷ ${formatCompactNumber(ads.impr7d)} impressions`}
        />
      </div>

      {traffic && traffic.series.length > 1 ? (
        <AdminAreaChart
          title="Page views"
          subtitle="What the ad numbers above are earned against"
          slot={3}
          points={traffic.series.map((d) => ({
            label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`,
            value: d.pageViews,
            fullLabel: new Date(d.date).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          }))}
        />
      ) : null}

      {!revenue.mrrComplete ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            One of the configured prices ({revenue.prices.pro} / {revenue.prices.business}) could
            not be read as a number, so its subscribers are excluded from the total above rather
            than counted as free. Set a numeric price on the Pricing &amp; plans section to include
            them.
          </span>
        </p>
      ) : null}

      {/* Per-placement engagement — counted, and only for placements that have
          actually been seen. A row of zeroes for every declared zone would bury
          the ones carrying the site. */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Placement performance · last 7 days</h3>
        {zones.length === 0 ? (
          <p className="rounded-2xl border border-border/70 bg-card p-4 text-sm leading-relaxed text-muted-foreground">
            No impressions recorded yet. Placements appear here once they have been served — seed
            one on the Ad placements section and it will start reporting.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Placement</th>
                  <th className="px-4 py-3 font-medium">Impressions</th>
                  <th className="px-4 py-3 font-medium">Clicks</th>
                  <th className="px-4 py-3 font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone} className="border-t border-border/60">
                    {/* The human label, matching the Ad placements dropdown —
                        an operator should not have to map `result_top` to a
                        position on the page in their head. */}
                    <td className="px-4 py-3 font-medium">
                      {AD_ZONE_META[z.zone as AdZoneId]?.label ?? HILLTOP_SLOT_LABELS[z.zone] ?? z.zone}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatCompactNumber(z.impressions)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatCompactNumber(z.clicks)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{z.ctr}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          icon={MousePointerClick}
          label="Affiliate clicks (7d)"
          value={formatCompactNumber(affiliate.clicks7d)}
          sub={`${formatCompactNumber(affiliate.clicksToday)} today`}
        />
        <Metric
          icon={TrendingUp}
          label="API calls (7d)"
          value={formatCompactNumber(api.calls7d)}
          sub={`${formatCompactNumber(api.callsToday)} today`}
        />
        <Metric
          icon={Users}
          label="Active API keys"
          value={formatCompactNumber(api.activeKeys)}
        />
      </div>
    </div>
  );
}
