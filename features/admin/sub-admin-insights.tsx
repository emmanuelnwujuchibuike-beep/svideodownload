"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SubReviewButton } from "@/features/admin/moderation-queue";
import { usd } from "@/lib/creator/membership/engine";
import type { AdminPurchaseRow, AdminSummary, ModRow } from "@/lib/sub/admin-reporting";
import { chargedAmount } from "@/lib/sub/lifecycle";
import { cn } from "@/lib/utils";

/**
 * Admin → Rewards → SUB: overview, search and Exclusive moderation (Frenz Exclusive Part 7).
 * Every request goes to an admin-only route that checks the admin itself; nothing is polled.
 * Money concepts are kept apart (gross per charged currency, creator share, platform fee, refunds)
 * and currencies are never added together. Media is reviewed only through the audited sub-review.
 */

// the Exclusive glass language (app/globals.css .ex-*): cards without blur, chips, buttons
const card = "ex-card px-3.5 py-3";
const field = "min-h-11 w-full rounded-2xl border border-black/[0.07] bg-white/70 px-3 text-sm outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-white/10 dark:bg-white/[0.05]";
const pill = (_on: boolean) => "ex-chip";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function SubAdminInsights() {
  return (
    <div className="mt-6 space-y-8">
      <Overview />
      <SearchPanel />
      <Moderation />
    </div>
  );
}

function Overview() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [s, setS] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async (d: number) => {
    const mine = ++seq.current;
    setLoading(true);
    const res = await fetch(`/api/admin/memberships/summary?days=${d}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as (AdminSummary & { error?: string }) | null;
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res?.ok || !j) return setError(j?.error ?? "Couldn't load the overview.");
    setError(null);
    setS(j);
  }, []);
  useEffect(() => void load(days), [days, load]);

  return (
    <section aria-labelledby="sa-ov">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="sa-ov" className="text-sm font-semibold">
          Overview
        </h3>
        <div role="radiogroup" aria-label="Period" className="flex gap-1">
          {([7, 30, 90] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={pill(days === d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {!s && loading ? <div aria-hidden className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" /> : null}
      {s ? (
        <div className={cn("space-y-2 transition-opacity motion-reduce:transition-none", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Num label="Paid memberships" v={s.memberships} hint="All time" />
            <Num label="Active now" v={s.active} hint={`${s.ending} ending (cancelled)`} />
            <Num label="New subscriptions" v={s.newSubs} hint={`In ${days} days`} />
            <Num label="Renewals" v={s.renewals} hint={`In ${days} days`} />
            <Num label="Access ended" v={s.accessEnded} hint={`In ${days} days`} />
            <Num label="Refunds" v={s.refunds} hint={`${usd(s.refundedCreatorCents)} taken back from creators`} />
            <Num label="Refund owed" v={s.refundDueOpen} hint="Paid after removal (refund_due)" />
            <Num label="Open withdrawals" v={s.withdrawalsOpen} hint={usd(s.withdrawalsOpenCents)} />
          </div>
          <div className={card}>
            <p className="text-xs font-semibold text-muted-foreground">Purchases settled in the last {days} days (before refunds)</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Creators&apos; share (USD)</dt>
                <dd className="font-bold tabular-nums">{usd(s.creatorShareCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Platform fees (USD)</dt>
                <dd className="font-bold tabular-nums">{usd(s.platformFeeCents)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Charged to subscribers, per currency (never summed):</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {s.grossByCurrency.length ? s.grossByCurrency.map((g) => <li key={g.currency} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums">{chargedAmount(g.minor, g.currency)}</li>) : <li className="text-xs text-muted-foreground">None</li>}
            </ul>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Num label="Open reports" v={s.reportsOpen} hint="Exclusive posts and comments" />
            <Num label="Posts removed" v={s.postsRemoved} hint="Taken down, kept" />
            <Num label="Comments hidden" v={s.commentsHidden} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Num({ label, v, hint }: { label: string; v: number; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-lg font-extrabold tabular-nums">{v.toLocaleString()}</p>
      <p className="text-xs font-semibold">{label}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const STATUSES = ["", "paid", "initiated", "failed", "refunded", "disputed", "reversed", "refund_due"] as const;

function SearchPanel() {
  const [q, setQ] = useState({ creator: "", subscriber: "", reference: "", status: "", from: "", to: "" });
  const [page, setPage] = useState<{ items: AdminPurchaseRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (cursor: string | null) => {
    setLoading(true);
    const params = new URLSearchParams(Object.entries({ ...q, ...(cursor ? { cursor } : {}) }).filter(([, v]) => v));
    const res = await fetch(`/api/admin/memberships/search?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { items?: AdminPurchaseRow[]; next?: string | null; error?: string } | null;
    setLoading(false);
    if (!res?.ok || !j?.items) return setError(j?.error ?? "Search failed.");
    setError(null);
    setPage((p) => (cursor && p ? { items: [...p.items, ...j.items!], next: j.next ?? null } : { items: j.items!, next: j.next ?? null }));
  };

  return (
    <section aria-labelledby="sa-search">
      <h3 id="sa-search" className="mb-2 text-sm font-semibold">
        Search subscriptions
      </h3>
      <form
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(null);
        }}
      >
        <input aria-label="Creator (@handle or id)" placeholder="Creator @handle" value={q.creator} onChange={(e) => setQ({ ...q, creator: e.target.value })} className={field} />
        <input aria-label="Subscriber (@handle or id)" placeholder="Subscriber @handle" value={q.subscriber} onChange={(e) => setQ({ ...q, subscriber: e.target.value })} className={field} />
        <input aria-label="Reference contains" placeholder="Reference contains" value={q.reference} onChange={(e) => setQ({ ...q, reference: e.target.value })} className={field} />
        <select aria-label="Status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })} className={field}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? s.replace("_", " ") : "Any status"}
            </option>
          ))}
        </select>
        <input aria-label="From date" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} className={field} />
        <input aria-label="To date" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} className={field} />
        <button type="submit" disabled={loading} className="ex-btn ex-btn--primary col-span-2 sm:col-span-3">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Search
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      {page ? (
        page.items.length ? (
          <ul className="ex-card ex-rows mt-3 overflow-hidden">
            {page.items.map((r) => (
              <li key={r.id} className="px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 font-semibold">
                    @{r.creator.handle ?? r.creator.id.slice(0, 8)} ← @{r.subscriber.handle ?? r.subscriber.id.slice(0, 8)}
                  </span>
                  <span className={cn("ex-status", r.status === "paid" ? "ex-status--good" : r.status === "initiated" ? "ex-status--pending" : r.status === "refund_due" ? "ex-status--warn" : r.status === "failed" ? "" : "ex-status--bad")}>{r.status.replace("_", " ")}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {usd(r.priceCents)} to creator + {usd(r.feeCents)} fee · charged {chargedAmount(r.chargedMinor, r.chargedCurrency)} · created {fmt(r.createdAt)}
                  {r.paidAt ? ` · paid ${fmt(r.paidAt)}` : ""}
                  {r.reversedAt ? ` · reversed ${fmt(r.reversedAt)}` : ""}
                </p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{r.reference}</p>
                {r.membership ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Membership now: {r.membership.status}
                    {r.membership.cancelled ? " (cancelled, ending)" : ""} · access until {fmt(r.membership.periodEnd)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No purchases match.</p>
        )
      ) : null}
      {page?.next ? (
        <button type="button" onClick={() => void run(page.next)} disabled={loading} className="ex-btn ex-btn--quiet mt-2 w-full">
          {loading ? "Loading…" : "More results"}
        </button>
      ) : null}
    </section>
  );
}

const MOD_FILTERS = [
  ["open", "Reported"],
  ["removed", "Removed"],
  ["restored", "Restored"],
  ["dismissed", "Dismissed"],
] as const;

function Moderation() {
  const [filter, setFilter] = useState<(typeof MOD_FILTERS)[number][0]>("open");
  const [type, setType] = useState<"sub_post" | "sub_comment">("sub_post");
  const [page, setPage] = useState<{ items: ModRow[]; next: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ row: ModRow; action: "remove" | "restore" | "dismiss" } | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (f: string, t: string, cursor: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    const res = await fetch(`/api/admin/memberships/moderation?filter=${f}&type=${t}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { items?: ModRow[]; next?: string | null; error?: string } | null;
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res?.ok || !j?.items) return setError(j?.error ?? "Couldn't load.");
    setError(null);
    setPage((p) => (cursor && p ? { items: [...p.items, ...j.items!], next: j.next ?? null } : { items: j.items!, next: j.next ?? null }));
  }, []);
  useEffect(() => void load(filter, type, null), [filter, type, load]);

  const confirm = async () => {
    if (!acting) return;
    const res = await fetch("/api/admin/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: acting.row.targetType, targetId: acting.row.targetId, action: acting.action, ...(note.trim() ? { note: note.trim() } : {}) }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { state?: string; changed?: boolean; error?: string } | null;
    // only the server's answer is shown as done
    setResult(res?.ok ? `Done: ${j?.state ?? acting.action}${j?.changed === false ? " (no change: it was already in that state)" : ""}.` : (j?.error ?? "That didn't go through. Nothing changed."));
    setActing(null);
    setNote("");
    if (res?.ok) void load(filter, type, null);
  };

  return (
    <section aria-labelledby="sa-mod">
      <h3 id="sa-mod" className="mb-2 text-sm font-semibold">
        Exclusive moderation
      </h3>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <div role="radiogroup" aria-label="State" className="flex flex-wrap gap-1">
          {MOD_FILTERS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={pill(filter === k)}>
              {l}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Content" className="flex gap-1">
          {(
            [
              ["sub_post", "Posts"],
              ["sub_comment", "Comments"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)} className={pill(type === k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite">{result ? <p className="ex-card mb-2 px-3.5 py-2.5 text-sm">{result}</p> : null}</div>
      {error ? (
        <p className="text-sm text-rose-600">
          {error}{" "}
          <button type="button" onClick={() => void load(filter, type, null)} className="inline-flex items-center gap-1 font-semibold underline">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </p>
      ) : null}
      {page?.items.length ? (
        <ul className={cn("ex-card ex-rows overflow-hidden", loading && "opacity-60")}>
          {page.items.map((r) => (
            <li key={`${r.targetType}:${r.targetId}`} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 break-words font-semibold">{r.title}</span>
                <span className={cn("ex-status", r.state === "published" || r.state === "visible" ? "ex-status--good" : r.state === "archived" || r.state === "hidden" ? "ex-status--bad" : "")}>{r.state === "archived" ? "removed" : r.state}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.handle ? `@${r.handle} · ` : ""}
                {fmt(r.at)}
                {r.reports ? ` · ${r.reports} report${r.reports === 1 ? "" : "s"}` : ""}
                {r.reasons.length ? ` · ${r.reasons.join(", ")}` : ""}
              </p>
              {r.note ? <p className="mt-0.5 text-xs">Reason: {r.note}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.state !== "missing" ? <SubReviewButton t={{ targetType: r.targetType, targetId: r.targetId }} /> : null}
                {r.state === "published" || r.state === "visible" ? (
                  <button type="button" onClick={() => setActing({ row: r, action: "remove" })} className="ex-btn ex-btn--danger ex-btn--sm">
                    Remove
                  </button>
                ) : null}
                {r.state === "archived" || r.state === "hidden" ? (
                  <button type="button" onClick={() => setActing({ row: r, action: "restore" })} className="ex-btn ex-btn--quiet ex-btn--sm">
                    Restore
                  </button>
                ) : null}
                {filter === "open" ? (
                  <button type="button" onClick={() => setActing({ row: r, action: "dismiss" })} className="ex-btn ex-btn--quiet ex-btn--sm">
                    Dismiss reports
                  </button>
                ) : null}
              </div>
              {acting && acting.row.targetId === r.targetId ? (
                <div className="ex-glass mt-2 rounded-2xl p-3">
                  <label className="block text-xs font-semibold">
                    Reason for {acting.action} (kept in the audit log{acting.action === "dismiss" ? "" : "; 3+ characters"})
                    <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={cn(field, "mt-1")} />
                  </label>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" onClick={() => void confirm()} disabled={acting.action !== "dismiss" && note.trim().length < 3} className="ex-btn ex-btn--primary ex-btn--sm">
                      Confirm {acting.action}
                    </button>
                    <button type="button" onClick={() => setActing(null)} className="ex-btn ex-btn--quiet ex-btn--sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !loading && !error ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : null}
      {page?.next ? (
        <button type="button" onClick={() => void load(filter, type, page.next)} disabled={loading} className="ex-btn ex-btn--quiet mt-2 w-full">
          {loading ? "Loading…" : "More"}
        </button>
      ) : null}
    </section>
  );
}
