import { AlertTriangle, Eye, TrendingUp, Users } from "lucide-react";

import { PageViewsChart } from "./page-views-chart";

import type { MonetizationAnalytics, RevenueStats } from "@/lib/monetization/stats";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The revenue picture — the first thing the dashboard shows.
 *
 * Subscription income and traffic only (owner 2026-10-12: "remove all the ad network
 * ad stats and card from the admin dashboard revenue", and the NGN collected-revenue
 * card — credits deposited are already reported in USD elsewhere). Ad impressions,
 * clicks, CTR and the estimated ad revenue are no longer shown here; the ads platform
 * keeps its own reporting.
 *
 * ── Every number here is counted, never modelled ──────────────────────────────
 * Subscription income is live subscriber counts multiplied by the prices set on the
 * pricing screen. Nothing is projected, annualised or estimated.
 *
 * ── Partial totals are labelled as partial ────────────────────────────────────
 * `mrrComplete` is false when a configured price is not a number ("Contact us"
 * is a real thing to write on a pricing page). The total then excludes that plan
 * and says so, rather than quietly counting those subscribers as free.
 */

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  emphasis,
  className,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        className,
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

  const { subscribers } = revenue;

  /*
    🔴 Owner, 2026-10-12: "remove all the ad network ad stats and card from the admin
    dashboard revenue" and the NGN "Total collected" card ("a wrong stat … I already
    have a section for credits deposited in USD"). Gone from this screen: the
    collected-revenue card, ad impressions / clicks, impressions per 100 views, the
    estimated ad revenue and the click-through rate, and the placement table. The
    data behind them is untouched (the ads platform keeps its own reporting); this
    screen now shows subscription income and traffic only.
  */
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
        {/* the third tile spans both columns on a phone so the row never leaves a hole */}
        <Metric
          className="col-span-2 lg:col-span-1"
          icon={Eye}
          label="Page views"
          value={traffic ? formatCompactNumber(traffic.pageViews) : "—"}
          sub={traffic ? `${formatCompactNumber(traffic.uniqueVisitors)} unique visitors` : "Analytics unavailable"}
        />
      </div>

      {traffic && traffic.series.length > 1 ? (
        <PageViewsChart series={traffic.series.map((d) => ({ date: d.date, value: d.pageViews }))} />
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

      {/* Affiliate clicks, API calls and Active API keys removed (owner, 2026-10-19: "remove this section from the admin, revenue section") */}
    </div>
  );
}
