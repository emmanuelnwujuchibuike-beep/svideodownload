import { AlertTriangle, MousePointerClick, Eye, TrendingUp, Users } from "lucide-react";

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
}: {
  revenue: RevenueStats | null;
  analytics: MonetizationAnalytics | null;
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
                      {AD_ZONE_META[z.zone as AdZoneId]?.label ?? z.zone}
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
