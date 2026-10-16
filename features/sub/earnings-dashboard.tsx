"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarRange, Info, Loader2, RefreshCw, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import { GLASS, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { Segmented } from "@/features/sub/segmented";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import type { LedgerEntry, Overview } from "@/lib/sub/earnings";
import { chargedAmount } from "@/lib/sub/lifecycle";
import { cn } from "@/lib/utils";

const EarningsChart = dynamic(() => import("@/features/sub/earnings-chart").then((m) => m.EarningsChart), { ssr: false, loading: () => <div aria-hidden className="h-[9.5rem] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" /> });
const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });

/**
 * Creator earnings (Frenz Exclusive Part 7). The first view is rendered on the server; changing the
 * period or the history filter fetches exactly that (no polling). Every figure is the server's and
 * keeps its own meaning: balances from sub_balances, period figures aggregated in the database,
 * subscribers' payments per charged currency (never added together). USD cents for creator money.
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
const fmtDay = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const W_STATUS: Record<string, string> = { pending: "Requested", reviewing: "In review", approved: "Approved", processing: "Paying out", completed: "Paid", rejected: "Declined", failed: "Failed", cancelled: "Cancelled" };

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
      <div className={cn("rounded-[22px] px-4 py-5", GLASS)}>
        <p className="text-[15px] font-semibold">Couldn&apos;t load your earnings</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Your money is safe; this is only the view. Try again.</p>
        <button type="button" onClick={() => void load(days)} disabled={loading} className={cn(quietPill, "mt-3")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
        </button>
      </div>
    );
  }

  const b = o.balances;
  const p = o.period;
  return (
    <div>
      {/* The balance — the one glass hero on the page */}
      <section aria-labelledby="bal-title" className={cn("relative overflow-hidden rounded-[26px] px-4 pb-4 pt-4", GLASS)}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.09] via-accent/[0.05] to-transparent" />
        <div className="relative">
          <p id="bal-title" className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" aria-hidden /> Available to withdraw
          </p>
          <p className="mt-1 break-all text-[clamp(1.9rem,9vw,2.4rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{usd(b.availableCents)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
            <Stat label="Earned, all time" value={usd(b.lifetimeCents)} hint="After refunds" />
            <Stat label="Paid out" value={usd(b.withdrawnCents)} hint="Completed withdrawals" />
            {b.heldCents ? <Stat label="In a withdrawal" value={usd(b.heldCents)} hint="Requested, not paid yet" /> : null}
            {b.pendingCents ? <Stat label="Clearing" value={usd(b.pendingCents)} hint="Becomes available after the hold" /> : null}
            {b.debtCents ? <Stat label="Owed back" value={usd(b.debtCents)} hint="Refunds of money already paid out" tone="warn" /> : null}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setWithdrawing(true)} disabled={!!o.withdrawal.reason} className={cn(primaryPill, "bg-gradient-to-r from-primary to-accent")}>
              <ArrowUpRight className="h-4 w-4" aria-hidden /> Withdraw
            </button>
            {o.withdrawal.reason ? (
              <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> {o.withdrawal.reason}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                {o.withdrawal.feePercent}% withdrawal fee · minimum {usd(o.withdrawal.minCents)}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Now */}
      <section aria-label="Right now" className="mt-3 grid grid-cols-3 gap-2">
        <Tile label="Active subscribers" value={o.activeSubscribers.toLocaleString()} />
        <Tile label="Ending" value={o.ending.toLocaleString()} hint="Cancelled, still paid up" />
        <Tile label="Exclusive posts" value={o.posts.published.toLocaleString()} hint={`${o.posts.locked} locked · ${o.posts.hidden} hidden`} />
      </section>

      {/* The period */}
      <section aria-labelledby="period-title" className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 id="period-title" className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" aria-hidden /> Last {days} days
          </h2>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Updating" /> : null}
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
        <div aria-live="polite" className="sr-only">
          {loading ? "Updating" : `Showing the last ${days} days`}
        </div>
        {error ? (
          <p className="mt-2 text-[12.5px] text-rose-600">
            Couldn&apos;t update.{" "}
            <button type="button" onClick={() => void load(days)} className="font-semibold underline">
              Retry
            </button>
          </p>
        ) : null}
        {!o.analyticsReady || !p ? (
          <p className={cn("mt-3 rounded-[22px] px-4 py-3.5 text-[13px] text-muted-foreground", GLASS)}>Period analytics arrive with the next update. Your balances above are current.</p>
        ) : (
          <div className={cn("mt-3 transition-opacity motion-reduce:transition-none", loading && "opacity-60")}>
            <div className={cn("rounded-[22px] px-4 py-3.5", GLASS)}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-[12.5px] font-semibold text-muted-foreground">Net earnings</p>
                <p className={cn("text-[22px] font-extrabold tabular-nums tracking-[-0.02em]", p.netCents < 0 && "text-rose-600 dark:text-rose-400")}>{signed(p.netCents)}</p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {usd(p.earnedCents)} earned{p.clawedCents ? ` − ${usd(p.clawedCents)} refunded` : ""}. Your share is the full price; the service fee is paid by subscribers on top.
              </p>
              <div className="mt-3">
                <EarningsChart points={p.daily} days={days} />
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Card label="New subscribers" value={p.newSubs} hint="First payment to you" />
              <Card label="Renewals" value={p.renewals} hint="Paid again" />
              <Card label="Access ended" value={p.accessEnded} hint="Paid time ran out or was refunded" />
              <Card label="Cancellations" value={p.cancellations} hint="Won't renew; access kept to the end" />
              <Card label="Refunds" value={p.refunds} hint="Payments refunded or reversed" />
              <Card label="Posts published" value={p.postsPublished} />
              <Card label="Likes" value={p.likes} hint="On your exclusive posts" />
              <Card label="Comments" value={p.comments} hint="Visible ones" />
              <Card label="Withdrawals" value={p.withdrawalsRequested} hint={p.withdrawalsCompleted ? `${p.withdrawalsCompleted} paid · ${usd(p.withdrawalsCompletedNetCents)}` : "None paid in this period"} />
            </dl>
            {p.grossByCurrency.length ? (
              <div className={cn("mt-2 rounded-[22px] px-4 py-3", GLASS)}>
                <p className="text-[12.5px] font-semibold">What subscribers paid</p>
                <p className="text-[12px] text-muted-foreground">Price plus service fee, in the currency they were charged. Currencies are shown apart, never added together.</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {p.grossByCurrency.map((g) => (
                    <li key={g.currency} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[13px] font-semibold tabular-nums dark:bg-white/[0.07]">
                      {chargedAmount(g.minor, g.currency)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">Views and impressions aren&apos;t recorded for exclusive posts, so they aren&apos;t shown. Days are counted in UTC.</p>
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

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[15px] font-bold tabular-nums", tone === "warn" && "text-rose-600 dark:text-rose-400")} title={hint}>
        {value}
      </dd>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn("min-w-0 rounded-[18px] px-3 py-2.5", GLASS)}>
      <p className="truncate text-[20px] font-extrabold leading-tight tabular-nums">{value}</p>
      <p className="text-[11.5px] font-semibold leading-tight text-foreground/80">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-black/[0.025] px-3 py-2.5 ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.04] dark:ring-white/[0.06]">
      <dt className="text-[12px] font-semibold text-foreground/80">{label}</dt>
      <dd className="text-[19px] font-extrabold tabular-nums">{value.toLocaleString()}</dd>
      {hint ? <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
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
    <section aria-labelledby="hist-title" className="mb-8 mt-6">
      <SectionHeader id="hist-title" title="History" />
      <div role="radiogroup" aria-label="Show" className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => apply({ filter: k })} className={cn("min-h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === k ? "bg-foreground text-background" : "bg-black/[0.05] text-foreground/75 dark:bg-white/[0.07]")}>
            {l}
          </button>
        ))}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[11.5px] font-medium text-muted-foreground">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => apply({ from: e.target.value })} className="mt-0.5 block min-h-10 w-full rounded-xl border border-black/[0.08] bg-black/[0.02] px-2.5 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-white/10 dark:bg-white/[0.04]" />
        </label>
        <label className="text-[11.5px] font-medium text-muted-foreground">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => apply({ to: e.target.value })} className="mt-0.5 block min-h-10 w-full rounded-xl border border-black/[0.08] bg-black/[0.02] px-2.5 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-white/10 dark:bg-white/[0.04]" />
        </label>
      </div>
      {page?.items.length ? (
        <ul className={cn("divide-y divide-black/[0.06] overflow-hidden rounded-[22px] dark:divide-white/[0.07]", GLASS, loading && "opacity-60")}>
          {page.items.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-3.5 py-3">
              <span aria-hidden className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", e.amountCents > 0 ? "bg-primary/10 text-primary" : e.amountCents < 0 ? "bg-black/[0.05] text-foreground/70 dark:bg-white/[0.07]" : "bg-accent/10 text-accent")}>
                {e.amountCents >= 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-snug">{e.label}</span>
                <span className="block text-[12px] text-muted-foreground" suppressHydrationWarning>
                  {fmtDay(e.at)}
                </span>
                {e.withdrawal ? (
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {W_STATUS[e.withdrawal.status] ?? e.withdrawal.status} · {usd(e.withdrawal.netCents)} to you after a {usd(e.withdrawal.feeCents)} fee
                  </span>
                ) : e.note && e.kind !== "earning" ? (
                  <span className="mt-0.5 block break-words text-[12px] text-muted-foreground">{e.note}</span>
                ) : null}
              </span>
              <span className={cn("shrink-0 text-right text-[14.5px] font-bold tabular-nums", e.amountCents > 0 && "text-primary", e.amountCents < 0 && "text-foreground")}>{e.kind === "withdrawal_paid" ? "Paid" : signed(e.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : !error ? (
        <p className={cn("rounded-[22px] px-4 py-4 text-center text-[13px] text-muted-foreground", GLASS)}>{filter === "all" && !from && !to ? "No activity yet. Your first subscriber's payment will show here." : "Nothing matches these filters."}</p>
      ) : null}
      {error ? (
        <div className={cn("mt-2 flex items-center justify-between gap-3 rounded-[22px] px-3.5 py-3", GLASS)}>
          <p className="text-[13px] text-muted-foreground">Couldn&apos;t load your history.</p>
          <button type="button" onClick={() => void load({ filter, from, to, cursor: null })} disabled={loading} className={quietPill}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </button>
        </div>
      ) : page?.next ? (
        <button type="button" onClick={() => void load({ filter, from, to, cursor: page.next })} disabled={loading} className={cn(quietPill, "mt-2 w-full justify-center")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {loading ? "Loading…" : "Show older"}
        </button>
      ) : null}
    </section>
  );
}
