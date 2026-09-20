import { Gift } from "lucide-react";

import type { CharacterReplaceFreeAccessStats } from "@/lib/ai/admin-stats";
import { formatCents } from "@/lib/ai/economy";

/**
 * Part 11 §19 — the complimentary-creation offer and the device rule, as
 * numbers. Server-rendered from the tables; no member media, no device ids.
 * The switches and bounds live in the pricing form's "Free access &
 * anti-abuse" group.
 */
export function CharacterReplaceFreeAccessPanel({ stats, symbol }: { stats: CharacterReplaceFreeAccessStats | null; symbol: string }) {
  if (!stats) {
    return (
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Gift className="h-5 w-5 text-primary" /> Complimentary creations
        </h2>
        <p className="text-sm text-muted-foreground">The figures could not be read — apply migration 0162 and refresh.</p>
      </section>
    );
  }
  const facts: [string, string, string?][] = [
    ["Accounts granted the offer", stats.accountsGranted.toLocaleString()],
    ["Creations granted", stats.creationsGranted.toLocaleString()],
    ["Creations used", stats.creationsConsumed.toLocaleString(), `${stats.creationsSettled.toLocaleString()} delivered`],
    ["Creations restored", stats.creationsRestored.toLocaleString(), "after a failure"],
    ["Accounts held at the device limit", stats.accountsAtDeviceLimit.toLocaleString(), `${stats.devicesAtLimit.toLocaleString()} devices`],
    ["Free → paid accounts", stats.freeToPaidAccounts.toLocaleString(), "used a free creation, then recharged"],
    ["Retail value of delivered free creations", formatCents(stats.deliveredNormalPriceCents, symbol), "the normal price, not charged"],
    ["Paid Character Replace revenue", formatCents(stats.revenueCents, symbol), "settled charges, all time"],
    ["Provider cost estimate", `$${(stats.providerCostUsdCents / 100).toFixed(2)}`, "your per-second figures × completed videos"],
  ];
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Gift className="h-5 w-5 text-primary" /> Complimentary creations
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">The offer and the device rule, in numbers. Bounds and switches are in Character Replace pricing → Free access &amp; anti-abuse.</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        {facts.map(([label, value, hint]) => (
          <div key={label} className="rounded-2xl border border-border/60 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-[20px] font-bold tabular-nums tracking-[-0.02em]">{value}</dd>
            {hint ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
