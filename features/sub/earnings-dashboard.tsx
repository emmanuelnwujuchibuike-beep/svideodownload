"use client";

import { ArrowDownLeft, ArrowUpRight, ChevronDown, Info, Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

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

type Days = 7 | 30 | 90 | 0;
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
  // 0254: the bank sent a paid payout back — the money is in your available balance again
  reversed: ["Returned to balance", "ex-status--warn"],
};
const FIELD = "mt-1 block min-h-11 w-full min-w-0 rounded-2xl border border-black/[0.07] bg-white/70 px-3 text-[14px] text-foreground outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-white/10 dark:bg-white/[0.05]";

export function EarningsDashboard({ initial, initialLedger }: { initial: Overview | null; initialLedger: LedgerPage | null }) {
  const [o, setO] = useState<Overview | null>(initial);
  const [days, setDays] = useState<Days>((initial?.period?.days as Days | undefined) ?? 30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initial === null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [asTable, setAsTable] = useState(false);
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
      <div role="alert" className="rounded-[20px] border border-frenz-line bg-frenz-card px-5 py-5 shadow-frenz-card">
        <p className="m-0 text-[15px] font-bold">Couldn&apos;t load your earnings</p>
        <p className="m-0 mt-1 text-[13px] text-frenz-muted">Your money is safe — only this view didn&apos;t load.</p>
        <button type="button" onClick={() => void load(days)} disabled={loading} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-frenz-fill px-4 text-[14px] font-bold">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Try again
        </button>
      </div>
    );
  }

  const b = o.balances;
  const p = o.period;
  const periodWord = days === 0 ? "all time" : `last ${days} days`;
  const prev = p?.previousEarnedCents ?? null;

  return (
    <div className="frenz-ui space-y-5 text-frenz-ink">
      {/* the period chips (design/Earnings.dc.html: 7D · 30D · 90D · All) */}
      <div role="radiogroup" aria-label="Reporting period" className="grid grid-cols-4 gap-0.5 rounded-xl bg-frenz-fill p-[3px]">
        {DAY_CHOICES.map(([d, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={days === d}
            onClick={() => choose(d)}
            className={cn("min-h-[38px] rounded-[9px] text-[14px] transition-colors", days === d ? "bg-frenz-card font-bold text-frenz-ink shadow-[0_1px_3px_rgba(18,17,26,0.12)]" : "font-semibold text-frenz-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      {!p ? (
        <p className="m-0 rounded-[20px] border border-frenz-line bg-frenz-card px-5 py-4 text-[13px] text-frenz-muted">Period analytics arrive with the next update. Your balance below is current.</p>
      ) : (
        <section aria-label={`Earned · ${periodWord}`} className={cn("rounded-[22px] border border-frenz-line bg-frenz-card p-4 shadow-frenz-raised transition-opacity duration-150 motion-reduce:transition-none", loading && "opacity-60")}>
          <p className="m-0 text-[13px] font-semibold text-frenz-muted">Earned · {periodWord}</p>
          <p className={cn("m-0 mt-1 font-heading text-[34px] font-extrabold leading-none tracking-[-1px] tabular-nums", p.netCents < 0 && "text-rose-600 dark:text-rose-400")}>{signedOrPlain(p.netCents)}</p>
          {/* the comparison is the server's two reads (lib/sub/earnings.ts), never estimated */}
          {prev !== null ? <p className="m-0 mt-1.5 text-[13px] text-frenz-muted">{usd(prev)} the {days} days before</p> : null}
          <div className="mt-4">
            <EarningsChart points={days === 0 ? byMonth(p.daily) : p.daily} days={days === 0 ? p.daily.length : days} />
          </div>
          <p className="m-0 mt-2 flex items-center justify-between text-[12.5px] text-frenz-muted">
            <span>Tap a bar for that day.</span>
            <button type="button" onClick={() => setAsTable((v) => !v)} aria-expanded={asTable} className="min-h-[36px] font-bold text-frenz-blue">
              {asTable ? "Hide table" : "View as table"}
            </button>
          </p>
          {asTable ? <DayTable points={p.daily} /> : null}
        </section>
      )}

      {/* the four figures */}
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Subscribers" value={o.activeSubscribers.toLocaleString()} note={p ? `+${p.newSubs.toLocaleString()} this period` : null} />
        <Kpi label="New subscribers" value={p ? p.newSubs.toLocaleString() : "—"} note={capital(periodWord)} />
        <Kpi label="Cancelled" value={p ? p.cancellations.toLocaleString() : "—"} note={capital(periodWord)} />
        <Kpi label="Profile visits" value={o.profileVisits === null ? "—" : o.profileVisits.toLocaleString()} note={capital(periodWord)} />
      </div>

      <section aria-labelledby="money-title">
        <h2 id="money-title" className="m-0 mb-2 px-1 font-heading text-[17px] font-bold">
          Where your money is
        </h2>
        <dl className="m-0 divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card">
          <MoneyRow label="Earned all time" note="Every subscription so far" value={usd(b.lifetimeCents)} />
          <MoneyRow label="Clearing" note="Not yet available" value={usd(b.pendingCents)} />
          <MoneyRow label="Withdrawn" note="Paid to your bank" value={usd(b.withdrawnCents)} />
          <MoneyRow label="Available to withdraw" note={`${o.withdrawal.feePercent}% fee applies when you withdraw`} value={usd(b.availableCents)} strong />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={() => setWithdrawing(true)} disabled={!!o.withdrawal.reason} className="inline-flex h-11 items-center gap-2 rounded-full bg-frenz-gradient-x px-5 font-heading text-[15px] font-bold text-white shadow-frenz-card disabled:opacity-45">
            <ArrowUpRight className="h-4 w-4" aria-hidden /> Withdraw
          </button>
          {o.withdrawal.reason ? (
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-[12.5px] text-frenz-muted">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> {o.withdrawal.reason}
            </p>
          ) : null}
        </div>
        {b.heldCents || b.debtCents ? (
          <p className="m-0 mt-2 px-1 text-[12.5px] text-frenz-muted">
            {b.heldCents ? `${usd(b.heldCents)} held for a withdrawal in progress. ` : ""}
            {b.debtCents ? `${usd(b.debtCents)} owed from a refund comes off your next earnings.` : ""}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="top-title">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 id="top-title" className="m-0 font-heading text-[17px] font-bold">
            Top exclusive posts
          </h2>
          <span className="text-[13px] text-frenz-muted">{o.posts.published.toLocaleString()} posts</span>
        </div>
        {o.topPosts === null ? (
          <p className="m-0 rounded-[20px] border border-frenz-line bg-frenz-card px-4 py-4 text-[13px] text-frenz-muted">Views couldn&apos;t be loaded right now.</p>
        ) : o.topPosts.length === 0 ? (
          <p className="m-0 rounded-[20px] border border-frenz-line bg-frenz-card px-4 py-4 text-[13px] text-frenz-muted">No views in this period yet. A view counts when a subscriber opens a post, once a day each.</p>
        ) : (
          <ol className="m-0 list-none divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card p-0 shadow-frenz-card">
            {o.topPosts.map((t) => (
              <li key={t.id} className="flex min-h-[68px] items-center gap-3 px-3.5 py-2.5">
                <span className="w-4 shrink-0 text-center font-heading text-[15px] font-bold text-frenz-muted">{t.rank}</span>
                <span aria-hidden className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-frenz-fill">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the post's own tiny blurred preview (a data URL) */}
                  {t.thumb ? <img src={t.thumb} alt="" className="h-full w-full scale-110 object-cover" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{t.kind === "video" ? "Video" : "Photo"}</span>
                  <span className="block text-[12.5px] text-frenz-muted" suppressHydrationWarning>
                    Posted {new Date(t.postedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </span>
                <span className="shrink-0 text-[14px] font-bold tabular-nums">
                  {t.views.toLocaleString()} {t.views === 1 ? "view" : "views"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {p ? (
        <details className="group rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-[15px] font-bold [&::-webkit-details-marker]:hidden">
            More figures for this period
            <ChevronDown className="h-4 w-4 text-frenz-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <dl className="m-0 divide-y divide-frenz-line border-t border-frenz-line">
            <Row label="Renewals" hint="Paid again" value={p.renewals} />
            <Row label="Access ended" hint="Paid time ran out or was refunded" value={p.accessEnded} />
            <Row label="Refunds" hint="Refunded or reversed payments" value={p.refunds} />
            <Row label="Withdrawals" hint={p.withdrawalsCompleted ? `${p.withdrawalsCompleted} paid · ${usd(p.withdrawalsCompletedNetCents)} to you` : "None paid in this period"} value={p.withdrawalsRequested} />
            <Row label="Posts published" value={p.postsPublished} />
            <Row label="Likes · comments" value={`${p.likes.toLocaleString()} · ${p.comments.toLocaleString()}`} />
          </dl>
          {p.grossByCurrency.length ? (
            <div className="border-t border-frenz-line px-4 py-3.5">
              <p className="m-0 text-[13.5px] font-semibold">What subscribers paid</p>
              <p className="m-0 mt-0.5 text-[12px] text-frenz-muted">Price plus service fee, in the currency charged. Shown apart, never added together. Your share is the full price.</p>
              <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
                {p.grossByCurrency.map((g) => (
                  <li key={g.currency} className="rounded-full bg-frenz-fill px-3 py-1.5 text-[13px] font-semibold tabular-nums">
                    {chargedAmount(g.minor, g.currency)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}
      <p className="m-0 px-1 text-[11.5px] leading-relaxed text-frenz-muted">Profile visits count each visitor once a day. Days are in UTC.</p>

      {error ? (
        <p role="alert" className="m-0 px-1 text-[12.5px] text-rose-600 dark:text-rose-400">
          Couldn&apos;t update.{" "}
          <button type="button" onClick={() => void load(days)} className="font-bold underline">
            Retry
          </button>
        </p>
      ) : null}

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

const DAY_CHOICES: [Days, string][] = [
  [7, "7D"],
  [30, "30D"],
  [90, "90D"],
  [0, "All"],
];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signedOrPlain = (c: number) => (c < 0 ? `−${usd(Math.abs(c))}` : usd(c));

/** All time, by month: a bar per month reads; a bar per day over a year does not. */
function byMonth(daily: { day: string; netCents: number; newSubs: number; renewals: number }[]) {
  const m = new Map<string, { day: string; netCents: number; newSubs: number; renewals: number }>();
  for (const d of daily) {
    const key = `${d.day.slice(0, 7)}-01`;
    const cur = m.get(key) ?? { day: key, netCents: 0, newSubs: 0, renewals: 0 };
    cur.netCents += d.netCents;
    cur.newSubs += d.newSubs;
    cur.renewals += d.renewals;
    m.set(key, cur);
  }
  return [...m.values()];
}

function DayTable({ points }: { points: { day: string; netCents: number; newSubs: number; renewals: number }[] }) {
  const rows = points.filter((x) => x.netCents || x.newSubs || x.renewals).reverse();
  if (!rows.length) return <p className="m-0 mt-2 text-[13px] text-frenz-muted">No activity in this period.</p>;
  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-frenz-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-frenz-fill text-frenz-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Day</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Net</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">New</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-frenz-line">
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="px-3 py-2">{r.day}</td>
              <td className="px-3 py-2 text-right tabular-nums">{signed(r.netCents)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.newSubs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string | null }) {
  return (
    <div className="min-w-0 rounded-[20px] border border-frenz-line bg-frenz-card px-3.5 py-3 shadow-frenz-card">
      <p className="m-0 truncate text-[12.5px] font-semibold text-frenz-muted">{label}</p>
      <p className="m-0 mt-0.5 truncate font-heading text-[24px] font-bold tabular-nums">{value}</p>
      {note ? <p className="m-0 truncate text-[12px] text-frenz-muted">{note}</p> : null}
    </div>
  );
}

function MoneyRow({ label, note, value, strong = false }: { label: string; note: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        <span className="block text-[12.5px] text-frenz-muted">{note}</span>
      </dt>
      <dd className={cn("m-0 shrink-0 tabular-nums", strong ? "font-heading text-[18px] font-extrabold" : "text-[15px] font-semibold")}>{value}</dd>
    </div>
  );
}


function Row({ label, hint, value }: { label: string; hint?: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint ? <span className="block text-[11.5px] leading-snug text-muted-foreground">{hint}</span> : null}
      </dt>
      <dd className="m-0 shrink-0 text-[16px] font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</dd>
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
      <h2 id="hist-title" className="m-0 mb-2 px-1 font-heading text-[17px] font-bold">
        Recent activity
      </h2>
      <div role="radiogroup" aria-label="Show" className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => apply({ filter: k })} className="ex-chip">
            {l}
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
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
