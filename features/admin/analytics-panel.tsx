import { BarChart3, MousePointerClick, Store, Target } from "lucide-react";

import type { MonetizationAnalytics } from "@/lib/monetization/stats";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Monetization analytics: 7-day ad CTR by zone + top affiliates (30d), drawn
 * with lightweight CSS bars (no chart lib → no bundle cost). Server-rendered.
 */
export function AnalyticsPanel({ data }: { data: MonetizationAnalytics | null }) {
  if (!data) return null;
  const { totals, adZones, topAffiliates } = data;
  const maxZone = Math.max(1, ...adZones.map((z) => z.impressions));
  const maxAff = Math.max(1, ...topAffiliates.map((a) => a.clicks));

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-5 flex items-center gap-2 font-semibold">
        <BarChart3 className="h-5 w-5 text-primary" /> Monetization analytics
      </h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini icon={Target} label="Ad impressions (7d)" value={formatCompactNumber(totals.adImpressions7d)} />
        <Mini icon={MousePointerClick} label="Ad clicks (7d)" value={formatCompactNumber(totals.adClicks7d)} />
        <Mini icon={BarChart3} label="Ad CTR (7d)" value={`${totals.ctr}%`} accent />
        <Mini icon={Store} label="Affiliate clicks (7d)" value={formatCompactNumber(totals.affiliateClicks7d)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold">Ad zones (7d)</h3>
          {adZones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ad activity yet.</p>
          ) : (
            <div className="space-y-3">
              {adZones.map((z) => (
                <div key={z.zone}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{z.zone}</span>
                    <span className="text-muted-foreground">
                      {formatCompactNumber(z.clicks)}/{formatCompactNumber(z.impressions)} · {z.ctr}% CTR
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{ width: `${Math.max(3, (z.impressions / maxZone) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Top affiliates (30d)</h3>
          {topAffiliates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No affiliate clicks yet.</p>
          ) : (
            <div className="space-y-3">
              {topAffiliates.map((a) => (
                <div key={a.id}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="text-muted-foreground">{formatCompactNumber(a.clicks)} clicks</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
                      style={{ width: `${Math.max(3, (a.clicks / maxAff) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        accent ? "border-primary/30 bg-primary/[0.04]" : "border-border/60 bg-secondary/25",
      )}
    >
      <Icon className={cn("h-4 w-4", accent ? "text-primary" : "text-muted-foreground")} />
      <p className="mt-2 text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
