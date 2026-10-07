"use client";

import type { AiMoneySummary } from "@/lib/ai/admin-money-view";
import type { PlanSurveySummary } from "@/lib/ai/credits/plan-survey";
import { formatCredits } from "@/lib/ai/credits/units";
import { formatCents } from "@/lib/ai/economy";

/**
 * AI → Overview — the money (credit brief §18): top-ups and revenue, credits
 * consumed and reserved, refunds, by tool, the heaviest users, and the
 * provider-cost estimate against what was spent. Every figure is read from the
 * ledger by lib/ai/admin-money.ts; a figure the data cannot support is shown as
 * "—", never as an invented zero.
 */
export function AiMoneyPanel({ money, labels, survey = null }: { money: AiMoneySummary; labels: Record<string, string>; survey?: (PlanSurveySummary & { capped: boolean }) | null }) {
  const usd = (c: number) => formatCents(c, "$");
  const cards: { label: string; value: string; hint: string }[] = [
    { label: "Top-up revenue", value: usd(money.topups.revenueUsdCents), hint: `${money.topups.count} top-up${money.topups.count === 1 ? "" : "s"}${money.topups.withoutPaidAmount ? ` · ${money.topups.withoutPaidAmount} without a settled amount` : ""}` },
    { label: "Credits sold", value: formatCredits(money.topups.credits, { short: true }), hint: money.topups.bonusCredits ? `+ ${formatCredits(money.topups.bonusCredits)} bonus` : "no bonus credits" },
    { label: "Credits spent", value: formatCredits(money.consumption.settledCredits, { short: true }), hint: `${money.consumption.jobs} paid creation${money.consumption.jobs === 1 ? "" : "s"} · worth ${usd(money.consumption.settledCredits * money.centsPerCredit)}` },
    { label: "Reserved now", value: formatCredits(money.consumption.reservedCredits, { short: true }), hint: "held by creations still running" },
    { label: "Refunded", value: formatCredits(money.refunds.credits, { short: true }), hint: `${money.refunds.count} refund${money.refunds.count === 1 ? "" : "s"}` },
    {
      label: "Provider cost (estimate)",
      value: money.providerCost.withEstimate ? usd(money.providerCost.usdCents) : "—",
      hint: `${money.providerCost.withEstimate} of ${money.providerCost.jobs} completed jobs carried an estimate`,
    },
    { label: "Estimated margin", value: money.estimatedMarginUsdCents === null ? "—" : usd(money.estimatedMarginUsdCents), hint: "credits spent at the credit rate − provider estimate" },
    { label: "Adjustments", value: formatCredits(money.adjustments.netCredits, { short: true }), hint: `${money.adjustments.count} by an operator or a grant` },
    { label: "Member transfers", value: formatCredits(money.transfers?.credits ?? 0, { short: true }), hint: `${money.transfers?.count ?? 0} transfer${money.transfers?.count === 1 ? "" : "s"} · ${formatCredits(money.transfers?.fees ?? 0)} in fees` },
  ];
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6" aria-label="Frenz AI money">
      <h2 className="font-semibold">Credits &amp; money · last {money.windowDays} days</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        From the wallet ledger, in credits (1 credit = {usd(money.centsPerCredit)}). Revenue is what top-ups actually settled. Failed jobs are on the operations panel above.
        {money.capped ? " Capped at the most recent 10,000 lines." : ""}
        {money.legacyMoneyRows ? ` ${money.legacyMoneyRows} dollar line(s) from before credits are not summed.` : ""}
      </p>
      {money.unreadable ? <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-600">The ledger could not be read just now.</p> : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border/70 bg-background/50 px-3 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{c.label}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums">{c.value}</dd>
            <dd className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Credits spent by tool</h3>
          {money.byFeature.length ? (
            <ul className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/70">
              {money.byFeature.map((f) => (
                <li key={f.tool} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>{labels[f.tool] ?? f.tool}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCredits(f.credits)} · {f.jobs} job{f.jobs === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No paid creations in this window.</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Members who spent the most</h3>
          {money.topUsers.length ? (
            <ul className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/70">
              {money.topUsers.map((u) => (
                <li key={u.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <code className="truncate text-xs">{u.userId}</code>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatCredits(u.credits)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nobody has spent credits in this window.</p>
          )}
        </div>
      </div>
      {/* 0190 (owner 2026-10-07): the optional survey new AI Pro / AI Max members answer on the celebration sheet */}
      {survey ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">AI plan survey · {survey.responses} answer{survey.responses === 1 ? "" : "s"}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Optional, asked once on the welcome screen after subscribing.{" "}
            {Object.entries(survey.byPlan).map(([plan, count]) => `${labels[plan] ?? plan}: ${count}`).join(" · ")}
            {survey.capped ? " Counted over the most recent 1,000 answers." : ""}
          </p>
          {survey.responses ? (
            <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
                {survey.features.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-muted-foreground">{f.count}</span>
                  </li>
                ))}
              </ul>
              <ul className="divide-y divide-border/60 self-start rounded-2xl border border-border/70">
                {survey.goals.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{g.label}</span>
                    <span className="tabular-nums text-muted-foreground">{g.count}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-2 self-start">
                {survey.comments.length ? (
                  survey.comments.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="rounded-2xl border border-border/70 px-3 py-2 text-sm">
                      <p>{c.comment}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{labels[c.plan] ?? c.plan} · {c.at.slice(0, 10)}</p>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No written comments yet.</li>
                )}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No answers yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
