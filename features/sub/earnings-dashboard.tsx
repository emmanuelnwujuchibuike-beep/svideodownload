"use client";

import { ArrowDownLeft, ArrowUpRight, Info, Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import { Segmented } from "@/features/sub/segmented";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import type { LedgerEntry, Overview } from "@/lib/sub/earnings";
import { chargedAmount } from "@/lib/sub/lifecycle";
import { cn } from "@/lib/utils";

const EarningsChart = dynamic(() => import("@/features/sub/earnings-chart").then((m) => m.EarningsChart), { ssr: false, loading: () => <div aria-hidden className="h-[8.5rem] rounded-2xl bg-black/[0.03] dark:bg-white/[0.04]" /> });
const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });

/**
 * Creator earnings (Frenz Exclusive Part 7), in the Exclusive glass language (app/globals.css
 * `.ex-*`): one glass hero for the balance, grouped lists for everything else — no wall of cards.
 * The first view is rendered on the server; changing the period or the history filter fetches
 * exactly that (no polling). Every figure is the server's and keeps its own meaning: balances from
 * sub_balances, period figures aggregated in the database, subscribers' payments per charged
 * currency (never added together). USD cents for creator money.
 */

type Days = 7 | 30 | 90;
type LedgerPage = { items: LedgerEntry[]; next: string | null };
const FILTERS = [
  ["all", "All"],
  ["earnings", "Earnings"],
  ["refunds", "Refunds"],
  ["withdrawals", "Withdrawals"],
  ["released", "Released"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const signed = (c: number) => (c === 0 ? usd(0) : `${c < 0 ? "−" : "+"}${usd(Math.abs(c))}`);
const fmtDay = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const W_STATUS: Record<string, [string, string]> = {
  pending: ["Requested", "ex-status--pending"],
  reviewing: ["In review", "ex-status--pending"],
  approved: ["Approved", "ex-status--pending"],
  processing: ["Paying out", "ex-status--pending"],
  completed: ["Paid", "ex-status--good"],
  rejected: ["Declined", "ex-status--bad"],
  failed: ["Failed", "ex-status--bad"],
  cancelled: ["Cancelled", ""],
};
const H2 = "mb-2 px-1 text-[12.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground";
const FIELD = "mt-1 block min-h-11 w-full rounded-2xl border border-black/[0.07] bg-white/70 px-3 text-[14px] text-foreground outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-white/10 dark:bg-white/[0.05]";

export function EarningsDashboard({ initial, initialLedger }: { initial: Overview | null; initialLedger: LedgerPage | null }) {
  const [o, setO] = useState<Overview | null>(initial);
  const [days, setDays] = useState<Days>((initial?.period?.days as Days | undefined) ?? 30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initial === null);
  const [withdrawing, setWithdrawing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (d: Days) => {
    const mine = ++seq.current;
    setLoading(true);
    const res = await fetch(`/api/sub/earnings/overview?days=${d}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as Overview | null;
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res?.ok || !j) return setError(true);
    setError(false);
    setO(j);
  }, []);

  const choose = (d: Days) => {
    if (d === days) return;
    haptic("selection");
    setDays(d);
    void load(d);
  };

  if (!o) {
    return (
      <div role="alert" className="ex-card px-5 py-5">
        <p className="text-[15px] font-semibold">Couldn&apos;t load your earnings</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Your money is safe — only this view didn&apos;t load.</p>
        <button type="button" onClick={() => void load(days)} disabled={loading} className="ex-btn ex-btn--glass mt-4">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Try again
        </button>
      </div>
    );
  }

  const b = o.balances;
  const p = o.period;
  const extras = [b.heldCents ? ["In a withdrawal", usd(b.heldCents), ""] : null, b.pendingCents ? ["Clearing", usd(b.pendingCents), ""] : null, b.debtCents ? ["Owed back", usd(b.debtCents), "warn"] : null].filter((x): x is string[] => !!x);
  return (
    <div className="space-y-6">
      {/* The balance — the one floating glass surface */}
      <section aria-labelledby="bal-title" className="ex-glass rounded-[28px] px-5 pb-5 pt-5">
        <p id="bal-title" className="text-[13px] font-medium text-muted-foreground">
          Available to withdraw
        </p>
        <p className="mt-1 break-all text-[clamp(2.1rem,10vw,2.75rem)] font-bold leading-none tracking-[-0.035em] tabular-nums">{usd(b.availableCents)}</p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{usd(b.lifetimeCents)}</span> earned all time · <span className="font-semibold text-foreground tabular-nums">{usd(b.withdrawnCents)}</span> paid out
        </p>
        {extras.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {extras.map(([label, value, tone]) => (
              <li key={label} className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium", tone === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-black/[0.045] text-foreground/80 dark:bg-white/[0.08]")}>
                {label} <span className="font-bold tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={() => setWithdrawing(true)} disabled={!!o.withdrawal.reason} className="ex-btn ex-btn--primary min-w-[9rem]">
            <ArrowUpRight className="h-4 w-4" aria-hidden /> Withdraw
          </button>
          <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            {o.withdrawal.reason ? <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            {o.withdrawal.reason ?? `${o.withdrawal.feePercent}% fee · minimum ${usd(o.withdrawal.minCents)}`}
          </p>
        </div>
      </section>

      {/* Right now — one strip, three figures */}
      <section aria-label="Right now" className="ex-card grid grid-cols-3 divide-x divide-black/[0.06] dark:divide-white/[0.07]">
        <Figure value={o.activeSubscribers} label="Subscribers" />
        <Figure value={o.ending} label="Ending" hint="Still paid up" />
        <Figure value={o.posts.published} label="Posts" hint={`${o.posts.hidden} hidden`} />
      </section>

      {/* The period */}
      <section aria-labelledby="period-title">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 id="period-title" className="text-[12.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            Last {days} days
          </h2>
          <span aria-live="polite" className="text-[12px] text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Updating
              </span>
            ) : error ? (
              <button type="button" onClick={() => void load(days)} className="font-semibold text-rose-600 underline-offset-2 hover:underline dark:text-rose-400">
                Couldn&apos;t update · Retry
              </button>
            ) : null}
          </span>
        </div>
        <Segmented
          label="Reporting period"
          value={String(days) as "7" | "30" | "90"}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
          onChange={(v) => choose(Number(v) as Days)}
        />
        {!o.analyticsReady || !p ? (
          <p className="ex-card mt-3 px-5 py-4 text-[13px] text-muted-foreground">Period analytics arrive with the next update. Your balance above is current.</p>
        ) : (
          <div className={cn("mt-3 space-y-3 transition-opacity duration-150 motion-reduce:transition-none", loading && "opacity-60")}>
            <div className="ex-card px-5 py-4">
              <p className="text-[13px] font-medium text-muted-foreground">Net earnings</p>
              <p className={cn("mt-0.5 text-[28px] font-bold leading-tight tracking-[-0.02em] tabular-nums", p.netCents < 0 && "text-rose-600 dark:text-rose-400")}>{signed(p.netCents)}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {usd(p.earnedCents)} earned{p.clawedCents ? `, ${usd(p.clawedCents)} refunded` : ""}
              </p>
              <div className="mt-4">
                <EarningsChart points={p.daily} days={days} />
              </div>
            </div>

            <dl className="ex-card ex-rows overflow-hidden">
              <Row label="New subscribers" hint="First payment to you" value={p.newSubs} />
              <Row label="Renewals" hint="Paid again" value={p.renewals} />
              <Row label="Cancellations" hint="Won't renew; access kept to the end" value={p.cancellations} />
              <Row label="Access ended" hint="Paid time ran out or was refunded" value={p.accessEnded} />
              <Row label="Refunds" hint="Refunded or reversed payments" value={p.refunds} />
              <Row label="Withdrawals" hint={p.withdrawalsCompleted ? `${p.withdrawalsCompleted} paid · ${usd(p.withdrawalsCompletedNetCents)} to you` : "None paid in this period"} value={p.withdrawalsRequested} />
              <Row label="Posts published" value={p.postsPublished} />
              <Row label="Likes · comments" value={`${p.likes.toLocaleString()} · ${p.comments.toLocaleString()}`} />
            </dl>

            {p.grossByCurrency.length ? (
              <div className="ex-card px-5 py-4">
                <p className="text-[13.5px] font-semibold">What subscribers paid</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Price plus service fee, in the currency charged. Shown apart, never added together. Your share is the full price.</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {p.grossByCurrency.map((g) => (
                    <li key={g.currency} className="rounded-full bg-black/[0.045] px-3 py-1.5 text-[13px] font-semibold tabular-nums dark:bg-white/[0.08]">
                      {chargedAmount(g.minor, g.currency)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">Views and impressions aren&apos;t recorded for exclusive posts, so they aren&apos;t shown. Days are in UTC.</p>
          </div>
        )}
      </section>

      <History initial={initialLedger} />

      {withdrawing ? (
        <SubWithdrawSheet
          onClose={() => setWithdrawing(false)}
          onDone={() => {
            void load(days);
          }}
        />
      ) : null}
    </div>
  );
}

function Figure({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <div className="min-w-0 px-3 py-3.5 text-center">
      <p className="truncate text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1.5 truncate text-[12px] font-semibold">{label}</p>
      {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Row({ label, hint, value }: { label: string; hint?: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint ? <span className="block text-[11.5px] leading-snug text-muted-foreground">{hint}</span> : null}
      </dt>
      <dd className="shrink-0 text-[16px] font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</dd>
    </div>
  );
}

function History({ initial }: { initial: LedgerPage | null }) {
  const [page, setPage] = useState<LedgerPage | null>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initial === null);
  const seq = useRef(0);

  const load = async (opts: { filter: Filter; from: string; to: string; cursor: string | null }) => {
    const mine = ++seq.current;
    setLoading(true);
    const q = new URLSearchParams({ filter: opts.filter, ...(opts.from ? { from: opts.from } : {}), ...(opts.to ? { to: opts.to } : {}), ...(opts.cursor ? { cursor: opts.cursor } : {}) });
    const res = await fetch(`/api/sub/earnings/ledger?${q.toString()}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as (LedgerPage & { error?: string }) | null;
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res?.ok || !j) return setError(true);
    setError(false);
    setPage((pg) => (opts.cursor && pg ? { items: [...pg.items, ...j.items.filter((x) => !pg.items.some((y) => y.id === x.id))], next: j.next } : j));
  };
  const apply = (next: Partial<{ filter: Filter; from: string; to: string }>) => {
    const f = next.filter ?? filter;
    const a = next.from ?? from;
    const z = next.to ?? to;
    setFilter(f);
    setFrom(a);
    setTo(z);
    void load({ filter: f, from: a, to: z, cursor: null });
  };

  return (
    <section aria-labelledby="hist-title" className="pb-6">
      <h2 id="hist-title" className={H2}>
        History
      </h2>
      <div role="radiogroup" aria-label="Show" className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => apply({ filter: k })} className="ex-chip">
            {l}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="px-1 text-[12px] font-medium text-muted-foreground">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => apply({ from: e.target.value })} className={FIELD} />
        </label>
        <label className="px-1 text-[12px] font-medium text-muted-foreground">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => apply({ to: e.target.value })} className={FIELD} />
        </label>
      </div>
      {page?.items.length ? (
        <ul className={cn("ex-card ex-rows overflow-hidden transition-opacity duration-150 motion-reduce:transition-none", loading && "opacity-60")}>
          {page.items.map((e) => {
            const w = e.withdrawal ? (W_STATUS[e.withdrawal.status] ?? [e.withdrawal.status, ""]) : null;
            return (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", e.amountCents > 0 ? "bg-primary/10 text-primary" : "bg-black/[0.05] text-foreground/70 dark:bg-white/[0.08]")}>
                  {e.amountCents > 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-snug">{e.label}</span>
                  <span className="block text-[12px] text-muted-foreground" suppressHydrationWarning>
                    {fmtDay(e.at)}
                    {e.withdrawal ? ` · ${usd(e.withdrawal.netCents)} to you, ${usd(e.withdrawal.feeCents)} fee` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {e.kind === "withdrawal_paid" ? null : <span className={cn("text-[15px] font-bold tabular-nums", e.amountCents > 0 && "text-primary")}>{signed(e.amountCents)}</span>}
                  {w ? <span className={cn("ex-status", w[1])}>{w[0]}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <div className="ex-card px-5 py-6 text-center">
          <p className="text-[14px] font-semibold">{filter === "all" && !from && !to ? "No activity yet" : "Nothing matches"}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{filter === "all" && !from && !to ? "Your first subscriber's payment will show here." : "Try another type or date range."}</p>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="ex-card mt-2 flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your history.</p>
          <button type="button" onClick={() => void load({ filter, from, to, cursor: null })} disabled={loading} className="ex-btn ex-btn--glass ex-btn--sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </button>
        </div>
      ) : page?.next ? (
        <button type="button" onClick={() => void load({ filter, from, to, cursor: page.next })} disabled={loading} className="ex-btn ex-btn--quiet mt-3 w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {loading ? "Loading…" : "Show older"}
        </button>
      ) : null}
    </section>
  );
}
