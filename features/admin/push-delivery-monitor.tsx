import { AlertTriangle, Radio, RefreshCw, Smartphone, Trash2 } from "lucide-react";

import type { PushDeliveryStats } from "@/lib/social/push-delivery-stats";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Real push-delivery health, computed directly from `push_delivery_log` /
 * `push_subscriptions` (Part 7) — same shape as MessagingMonitor
 * (features/admin/messaging-monitor.tsx), the established pattern for this
 * admin page's sections.
 */
export function PushDeliveryMonitor({ stats }: { stats: PushDeliveryStats }) {
  const failureTone =
    stats.failureRate7d >= 5 ? "text-red-500" : stats.failureRate7d >= 1 ? "text-amber-500" : "text-emerald-500";

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <h2 className="mb-5 flex items-center gap-2 font-semibold">
        <Radio className="h-5 w-5 text-primary" /> Push delivery
      </h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini icon={Smartphone} label="Active subscriptions" value={formatCompactNumber(stats.activeSubscriptions)} />
        <Mini icon={Radio} label="Sent (24h)" value={formatCompactNumber(stats.sent24h)} />
        <Mini icon={RefreshCw} label="Recovered by retry (7d)" value={formatCompactNumber(stats.retried7d)} />
        <Mini icon={Trash2} label="Dead subs pruned (7d)" value={formatCompactNumber(stats.pruned7d)} />
      </div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/25 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Delivery failure rate (7d)
          </span>
          <span className={cn("text-lg font-bold tracking-tight", failureTone)}>{stats.failureRate7d}%</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatCompactNumber(stats.failed7d)} failed out of ~{formatCompactNumber(stats.sent7d + stats.failed7d)} delivery attempts (after one automatic retry).
        </p>
        {stats.topErrors.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
            {stats.topErrors.map((r) => (
              <li key={r.error} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-mono text-muted-foreground">{r.error}</span>
                <span className="shrink-0 font-medium">{formatCompactNumber(r.count)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">No delivery failures logged in the last 7 days.</p>
        )}
      </div>
    </section>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof Radio; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-2 text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
