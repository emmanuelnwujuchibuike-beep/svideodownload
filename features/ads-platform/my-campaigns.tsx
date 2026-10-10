"use client";

import { BarChart3, ChevronRight, CreditCard, HelpCircle, LayoutGrid, Loader2, Megaphone, Plus, Search, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AiButtonLink } from "@/features/ai/design/ai-button";
import { AiPanel } from "@/features/ai/design/ai-surface";
import { useUser } from "@/features/auth/use-user";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

import { Chip } from "./advertise-ui";
import {
  byCampaign,
  byDay,
  date,
  liveCreative,
  loadCampaigns,
  loadPayments,
  loadStats,
  loadSummary,
  manage,
  num,
  PAGE_SIZE,
  pct,
  remaining,
  REMOVABLE_STATUSES,
  statusLabel,
  totalsOf,
  usd,
  type CampaignRow,
  type PaymentRow,
  type SortKey,
  type StatRow,
  type Summary,
  type Tone,
  type Totals,
} from "./dashboard/dashboard-data";
import { TestModeNote } from "./dashboard/test-mode-note";
import { patchDash, refreshAdDashboard, useDash } from "./dashboard/use-dash";

// the detail page, fetched only when a campaign is opened
const CampaignDetail = dynamic(() => import("./dashboard/campaign-detail").then((m) => m.CampaignDetail), { ssr: false, loading: () => <Skeleton /> });

/**
 * The advertiser dashboard (Part 6) — an upgrade of "My campaigns", on the same
 * static page: Overview · Campaigns · Analytics · Payments · Help, plus Create.
 * A campaign opens in place (`?c=<id>`), so nothing here is server-rendered and
 * no function runs to show it. Every figure is the database's own count.
 */
type Tab = "overview" | "campaigns" | "analytics" | "payments" | "help";
const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "help", label: "Rules & help", icon: HelpCircle },
];

export function MyCampaigns() {
  const { user, loading } = useUser();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "overview") as Tab;
  const openId = params.get("c");
  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(q)) if (v === null) next.delete(k);
    else next.set(k, v);
    router.replace(`/advertise/campaigns${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  if (!loading && !user) {
    return (
      <AiPanel className="text-center">
        <p className="text-[15px] font-semibold">Sign in to see your campaigns</p>
        <TapOnceLink href={`/login?next=${encodeURIComponent("/advertise/campaigns")}`} className="ai-btn ai-btn--primary mt-4 inline-flex">
          Sign in
        </TapOnceLink>
      </AiPanel>
    );
  }
  if (!user) return <Skeleton />;
  if (openId) return <CampaignDetail id={openId} onBack={() => go({ c: null })} />;

  return (
    <div>
      <div className="border-b border-border/80">
        <nav className="-mb-px flex min-w-0 gap-5 overflow-x-auto" aria-label="Dashboard sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => go({ tab: id === "overview" ? null : id })}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-[2.75rem] shrink-0 items-center gap-1.5 border-b-2 px-0.5 text-[13.5px] font-semibold transition-colors",
                tab === id ? "border-indigo-600 text-foreground dark:border-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="mt-3">
        <AiButtonLink tapOnce href="/advertise/create" prefetch={false} size="sm" icon={<Plus className="h-4 w-4" />} className="w-full justify-center sm:w-auto">
          Create Advertisement
        </AiButtonLink>
      </div>
      <div className="mt-5">
        {tab === "overview" ? <Overview onOpen={(id) => go({ c: id })} onTab={(t) => go({ tab: t })} /> : null}
        {tab === "campaigns" ? <Campaigns onOpen={(id) => go({ c: id })} /> : null}
        {tab === "analytics" ? <Analytics onOpen={(id) => go({ c: id })} /> : null}
        {tab === "payments" ? <Payments onOpen={(id) => go({ c: id })} /> : null}
        {tab === "help" ? <Help /> : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────── shared pieces ─────────────────────────────── */

export function Skeleton() {
  return (
    <div className="space-y-3" aria-busy>
      {[0, 1].map((i) => (
        <span key={i} className="block h-32 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}

/** A section title in the dashboard's one voice: small caps, quiet, with an optional action on the right. */
function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[2.25rem] items-center justify-between gap-3">
      <h2 id={id} className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Figures in one panel, split by hairlines — the ledger look of a serious ads console. */
function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-inset ring-border/70", className)}>{children}</div>;
}

function Stat({ label, value, hint, emphasis }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <div className="bg-card px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-semibold leading-none tracking-tight tabular-nums", emphasis ? "text-[1.75rem]" : "text-[1.45rem]")}>{value}</p>
      {hint ? <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A quiet panel: card ground, hairline ring, no wash. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-card ring-1 ring-inset ring-border/70", className)}>{children}</div>;
}

/** Segmented control for ranges and filters. */
function Segmented<T extends string | number>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex gap-0.5 rounded-xl bg-secondary p-1" role="tablist" aria-label={label}>
        {items.map((it) => (
          <button
            key={String(it.id)}
            type="button"
            role="tab"
            aria-selected={value === it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "min-h-[2.25rem] shrink-0 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-semibold transition",
              value === it.id ? "bg-card text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const DOT: Record<Tone, string> = { emerald: "bg-emerald-500", indigo: "bg-indigo-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" };

function StatusText({ c }: { c: CampaignRow }) {
  const l = statusLabel(c);
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[l.tone], l.tone === "emerald" && "ring-[3px] ring-emerald-500/20")} aria-hidden />
      {l.text}
    </span>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Panel className="px-6 py-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" aria-hidden>
        <Megaphone className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[15px] font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p>
      <AiButtonLink tapOnce href="/advertise/create" prefetch={false} className="mt-5">
        Create Advertisement
      </AiButtonLink>
    </Panel>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel className="px-6 py-8 text-center">
      <p className="text-[14px] font-semibold">We couldn&apos;t load this right now.</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-[2.75rem] text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
        Try again
      </button>
    </Panel>
  );
}

export function Thumb({ c, size = "md" }: { c: Pick<CampaignRow, "ad_creatives">; size?: "sm" | "md" }) {
  const cr = liveCreative(c);
  // an image, or a video's poster — never the video itself in a list
  const src = cr ? (cr.media_type === "image" ? cr.media_url : cr.thumbnail_url) : null;
  const box = size === "sm" ? "h-12 w-12 rounded-lg" : "h-14 w-14 rounded-xl";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a CDN creative preview; previews are not ad views and record nothing
    <img src={src} alt="" loading="lazy" decoding="async" className={cn(box, "shrink-0 bg-muted object-cover ring-1 ring-inset ring-black/5")} />
  ) : (
    <span className={cn(box, "flex shrink-0 items-center justify-center bg-muted text-muted-foreground")} aria-hidden>
      <Megaphone className="h-5 w-5" />
    </span>
  );
}

/* ─────────────────────────────── overview ─────────────────────────────── */

function Overview({ onOpen, onTab }: { onOpen: (id: string) => void; onTab: (t: Tab) => void }) {
  const summary = useDash<Summary>("summary", async () => {
    const v = await loadSummary();
    if (!v) throw new Error("summary");
    return v;
  });
  const recentQ = useDash("recent", async () => {
    const r = await loadCampaigns({ search: "", statuses: null, sort: "newest", page: 0 });
    const rows = r.rows.slice(0, 4);
    const stats = rows.length ? byCampaign(await loadStats(rows.map((x) => x.id), null)) : new Map<string, Totals>();
    return { rows, stats };
  });
  const s = summary.data;
  if (!s && summary.error) return <Failed onRetry={refreshAdDashboard} />;
  if (!s) return <Skeleton />;
  if (s.total === 0) return <Empty title="No campaigns yet" body="Create your first ad — choose where it shows, upload it, see the price, and go live after payment." />;
  const ctr = s.impressions > 0 ? s.clicks / s.impressions : null;
  return (
    <div className="space-y-6">
      <section aria-labelledby="ov-perf">
        <SectionTitle id="ov-perf">Performance · all time</SectionTitle>
        <KpiGrid className="mt-1.5 grid-cols-2 sm:grid-cols-3">
          <Stat emphasis label="Views" value={num(s.impressions)} hint="Seen on screen for at least a second" />
          <Stat emphasis label="Clicks" value={num(s.clicks)} />
          <Stat emphasis label="CTR" value={pct(ctr)} hint="Clicks ÷ views" />
          <Stat label="Spend" value={usd(s.spend_usd_cents)} hint="Verified payments" />
          {/* 0201 (owner, 2026-10-09): opening the ad's details on Frenzsave is a conversion; the visit after the warning is a site visit */}
          <Stat label="Conversions" value={num(s.conversions)} hint="Opened your ad's details" />
          <Stat label="Site visits" value={num(s.outbounds)} hint="Went on to your link" />
        </KpiGrid>
      </section>
      <section aria-labelledby="ov-camp">
        <SectionTitle id="ov-camp">Campaigns</SectionTitle>
        <KpiGrid className="mt-1.5 grid-cols-3 sm:grid-cols-6">
          <Stat label="Total" value={num(s.total)} />
          <Stat label="Live" value={num(s.live)} />
          <Stat label="To pay" value={num(s.awaiting_payment)} />
          <Stat label="Validating" value={num(s.validating)} />
          <Stat label="Paused" value={num(s.paused)} />
          <Stat label="Expired" value={num(s.expired)} />
        </KpiGrid>
      </section>
      <section aria-labelledby="ov-recent">
        <SectionTitle
          id="ov-recent"
          action={
            <button type="button" onClick={() => onTab("campaigns")} className="min-h-[2.25rem] text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
              All campaigns →
            </button>
          }
        >
          Recent campaigns
        </SectionTitle>
        <div className="mt-1.5">
          {recentQ.data ? <CampaignList rows={recentQ.data.rows} stats={recentQ.data.stats} onOpen={onOpen} onRemoved={refreshAdDashboard} /> : <Skeleton />}
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────── campaigns ─────────────────────────────── */

const FILTERS: { label: string; statuses: string[] | null }[] = [
  { label: "All", statuses: null },
  { label: "Live", statuses: ["active"] },
  { label: "Needs payment", statuses: ["draft", "awaiting_payment", "payment_processing"] },
  { label: "Validating", statuses: ["paid", "validating"] },
  { label: "Paused", statuses: ["paused"] },
  { label: "Ended", statuses: ["expired", "rejected", "removed"] },
];

const NO_TOTALS: Totals = { views: 0, clicks: 0, ctr: null, videoPlays: 0, videoCompletes: 0, rewardCompletes: 0, conversions: 0, outbounds: 0, filtered: 0 };

/** One table-like list: every campaign a row, figures in aligned columns on wide screens. */
function CampaignList({ rows, stats, onOpen, onRemoved }: { rows: CampaignRow[]; stats: Map<string, Totals> | null; onOpen: (id: string) => void; onRemoved: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error ? (
        <p role="alert" className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      <Panel className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_5rem_4.5rem_2.75rem] items-center gap-3 border-b border-border/70 bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid">
          <span>Campaign</span>
          <span className="text-right">Views</span>
          <span className="text-right">Clicks</span>
          <span className="text-right">CTR</span>
          <span />
        </div>
        <ul className="divide-y divide-border/60">
          {rows.map((c) => (
            <CampaignRowItem key={c.id} c={c} totals={stats ? (stats.get(c.id) ?? NO_TOTALS) : null} onOpen={onOpen} onRemoved={onRemoved} onError={setError} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function CampaignRowItem({ c, totals, onOpen, onRemoved, onError }: { c: CampaignRow; totals: Totals | null; onOpen: (id: string) => void; onRemoved: (id: string) => void; onError: (m: string | null) => void }) {
  const left = c.status === "active" || c.status === "paused" ? remaining(c.end_at) : null;
  const paid = c.payment_verified_at ? "Paid" : c.status === "payment_processing" ? "Payment processing" : "Not paid";
  const dates = c.start_at || c.end_at ? `${date(c.start_at)} – ${date(c.end_at)}${left ? ` · ${left}` : ""}` : null;
  return (
    <li className="group grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_5.5rem_5rem_4.5rem_2.75rem]">
      <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 items-center gap-3 text-left">
        <Thumb c={c} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold">{c.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <StatusText c={c} />
            <span aria-hidden>·</span>
            <span className="truncate">{c.ad_placements?.name ?? "—"}</span>
            <span aria-hidden>·</span>
            <span>{paid}</span>
          </span>
          {dates ? <span className="mt-0.5 block text-[12px] tabular-nums text-muted-foreground">{dates}</span> : null}
          {totals ? (
            <span className="mt-1.5 flex gap-4 text-[12px] tabular-nums text-muted-foreground sm:hidden">
              <span><b className="font-semibold text-foreground">{num(totals.views)}</b> views</span>
              <span><b className="font-semibold text-foreground">{num(totals.clicks)}</b> clicks</span>
              <span>CTR <b className="font-semibold text-foreground">{pct(totals.ctr)}</b></span>
            </span>
          ) : null}
        </span>
      </button>
      <span className="hidden text-right text-[13.5px] font-semibold tabular-nums sm:block">{totals ? num(totals.views) : "—"}</span>
      <span className="hidden text-right text-[13.5px] font-semibold tabular-nums sm:block">{totals ? num(totals.clicks) : "—"}</span>
      <span className="hidden text-right text-[13.5px] tabular-nums text-muted-foreground sm:block">{totals ? pct(totals.ctr) : "—"}</span>
      <span className="flex justify-end">
        {REMOVABLE_STATUSES.includes(c.status) ? (
          <RemoveButton c={c} onRemoved={onRemoved} onError={onError} />
        ) : (
          <button type="button" onClick={() => onOpen(c.id)} aria-label={`Open ${c.name}`} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * 0213: take a draft or finished campaign off the list. Two taps — the first
 * arms, the second removes — so a stray tap never removes anything. Unpaid
 * drafts are cancelled; finished campaigns are only hidden (their records stay).
 */
function RemoveButton({ c, onRemoved, onError }: { c: CampaignRow; onRemoved: (id: string) => void; onError: (m: string | null) => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!armed) {
      setArmed(true);
      onError(null);
      return;
    }
    setBusy(true);
    const r = await manage<{ removed: true }>({ action: "remove", campaignId: c.id });
    setBusy(false);
    setArmed(false);
    if (r.ok) onRemoved(c.id);
    else onError(r.message);
  }
  return (
    <button
      type="button"
      onClick={() => void remove()}
      onBlur={() => !busy && setArmed(false)}
      disabled={busy}
      aria-label={armed ? `Confirm: remove ${c.name} from your list` : `Remove ${c.name} from your list`}
      className={cn(
        "flex h-10 items-center justify-center rounded-full text-[12px] font-semibold transition disabled:opacity-60",
        armed ? "bg-rose-600 px-3 text-white" : "w-10 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : armed ? "Remove" : <Trash2 className="h-4 w-4" aria-hidden />}
    </button>
  );
}

function Campaigns({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState(0);
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(0);

  // search on a pause in typing — no request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(typed);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  type ListData = { rows: CampaignRow[]; total: number; stats: Map<string, Totals> };
  const q = useDash<ListData>(`list:${filter}:${sort}:${page}:${search}`, async () => {
    const r = await loadCampaigns({ search, statuses: FILTERS[filter]!.statuses, sort, page });
    const stats = await loadStats(r.rows.map((x) => x.id), null);
    return { ...r, stats: byCampaign(stats) };
  });
  const data: ListData | null | "error" = q.data ?? (q.error ? "error" : null);

  // a removed row leaves at once; every section is then re-read so counts and paging stay true
  const removed = (id: string) => {
    patchDash<ListData>(q.key, (d) => (d ? { ...d, rows: d.rows.filter((r) => r.id !== id), total: Math.max(0, d.total - 1) } : d!));
    refreshAdDashboard();
  };

  const pages = data && data !== "error" ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search campaigns</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by campaign name" className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base outline-none sm:text-[14px] transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20" />
        </label>
        <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(0); }} aria-label="Sort campaigns" className="h-11 rounded-xl border border-border bg-card px-3 text-base sm:text-[13.5px]">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="ending">Ending soonest</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <Segmented label="Filter by status" items={FILTERS.map((f, i) => ({ id: i, label: f.label }))} value={filter} onChange={(i) => { setFilter(i); setPage(0); }} />
      {data && data !== "error" ? (
        <p className="text-[12px] tabular-nums text-muted-foreground">
          {num(data.total)} campaign{data.total === 1 ? "" : "s"}
        </p>
      ) : null}
      <div>
        {data === "error" ? <Failed onRetry={refreshAdDashboard} /> : !data ? <Skeleton /> : data.rows.length === 0 ? (
          search || filter ? <p className="py-8 text-center text-[13.5px] text-muted-foreground">No campaigns match.</p> : <Empty title="No campaigns yet" body="Your campaigns will appear here." />
        ) : (
          <CampaignList rows={data.rows} stats={data.stats} onOpen={onOpen} onRemoved={removed} />
        )}
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-[13px]">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="min-h-[2.5rem] rounded-xl border border-border bg-card px-4 font-semibold disabled:opacity-40">Previous</button>
          <span className="tabular-nums text-muted-foreground">Page {page + 1} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="min-h-[2.5rem] rounded-xl border border-border bg-card px-4 font-semibold disabled:opacity-40">Next</button>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── analytics ─────────────────────────────── */

const RANGES: { id: string; label: string; days: number | null }[] = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "all", label: "Lifetime", days: null },
];

export function fromDay(days: number | null): string | null {
  if (!days) return null;
  const d = new Date(Date.now() - (days - 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** Views per day: bars on a ruled ground, the scale written on it, bars never wider than a column should be. */
export function DayChart({ rows }: { rows: { day: string; views: number; clicks: number }[] }) {
  if (!rows.length) return <p className="py-10 text-center text-[13px] text-muted-foreground">No views in this period yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <div>
      <div className="relative h-44">
        {/* the rules: top = the busiest day, middle = half of it */}
        {[0, 50, 100].map((p) => (
          <div key={p} className={cn("absolute inset-x-0 border-t", p === 100 ? "border-border" : "border-dashed border-border/60")} style={{ top: `${p}%` }} aria-hidden />
        ))}
        <span className="absolute right-0 top-0 -translate-y-full pb-0.5 text-[10.5px] tabular-nums text-muted-foreground" aria-hidden>{num(max)}</span>
        <div className="absolute inset-0 flex items-end justify-center gap-[3px] px-0.5" role="img" aria-label={`Views per day: ${rows.map((r) => `${r.day} ${r.views}`).join(", ")}`}>
          {rows.map((r) => (
            <div key={r.day} className="group/bar flex h-full max-w-[2.25rem] flex-1 flex-col justify-end" title={`${shortDay(r.day)}: ${num(r.views)} views, ${num(r.clicks)} clicks`}>
              <div className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-violet-400 transition-opacity group-hover/bar:opacity-80" style={{ height: `${Math.max(1.5, (r.views / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{shortDay(rows[0]!.day)}</span>
        {rows.length > 1 ? <span>{shortDay(rows[rows.length - 1]!.day)}</span> : null}
      </div>
    </div>
  );
}

function Analytics({ onOpen }: { onOpen: (id: string) => void }) {
  const [range, setRange] = useState("30");
  const q = useDash(`analytics:${range}`, async () => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const [s, c] = await Promise.all([loadStats(null, fromDay(days)), loadCampaigns({ search: "", statuses: null, sort: "newest", page: 0 })]);
    return { rows: s, names: new Map(c.rows.map((x) => [x.id, x.name])) };
  });
  const rows: StatRow[] | null = q.data?.rows ?? null;
  const names = q.data?.names ?? new Map<string, string>();
  const totals = useMemo(() => (rows ? totalsOf(rows) : null), [rows]);
  const per = useMemo(() => (rows ? [...byCampaign(rows)].sort((a, b) => b[1].views - a[1].views) : []), [rows]);
  const rangeLabel = RANGES.find((r) => r.id === range)!.label;
  return (
    <div className="space-y-5">
      <Segmented label="Time range" items={RANGES.map((r) => ({ id: r.id, label: r.label }))} value={range} onChange={setRange} />
      {!rows || !totals ? <Skeleton /> : (
        <>
          <TestModeNote />
          <KpiGrid className="grid-cols-2 sm:grid-cols-3">
            <Stat emphasis label="Views" value={num(totals.views)} />
            <Stat emphasis label="Clicks" value={num(totals.clicks)} />
            <Stat emphasis label="CTR" value={pct(totals.ctr)} hint="Clicks ÷ views" />
            <Stat label="Video completions" value={num(totals.videoCompletes + totals.rewardCompletes)} hint={totals.videoPlays ? `${num(totals.videoPlays)} plays` : "Watched to the end"} />
            <Stat label="Conversions" value={num(totals.conversions)} hint="Opened your ad's details" />
            <Stat label="Site visits" value={num(totals.outbounds)} hint="Went on to your link" />
          </KpiGrid>
          <Panel className="p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold">Views per day</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{rangeLabel} · UTC</p>
              </div>
              <p className="text-[1.25rem] font-semibold tabular-nums tracking-tight">{num(totals.views)}</p>
            </div>
            <div className="mt-6">
              <DayChart rows={byDay(rows)} />
            </div>
          </Panel>
          <section aria-labelledby="an-by">
            <SectionTitle id="an-by">By campaign</SectionTitle>
            <Panel className="mt-1.5 overflow-hidden">
              {per.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing yet in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-left text-[13px]">
                    <thead className="border-b border-border/70 bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Campaign</th>
                        <th className="px-3 py-2 text-right font-semibold">Views</th>
                        <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                        <th className="px-3 py-2 text-right font-semibold">CTR</th>
                        <th className="px-4 py-2 text-right font-semibold">Conv.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {per.map(([id, t]) => (
                        <tr key={id} className="transition-colors hover:bg-muted/40">
                          <td className="px-4 py-2.5"><button type="button" onClick={() => onOpen(id)} className="max-w-[14rem] truncate text-left font-semibold text-foreground hover:text-indigo-700 dark:hover:text-indigo-300">{names.get(id) ?? "Campaign"}</button></td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{num(t.views)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(t.clicks)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{pct(t.ctr)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{num(t.conversions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>
          <p className="text-[12px] leading-relaxed text-muted-foreground">A view counts once, when at least half of your ad stays on screen for a full second. Clicks open your link. Figures update as people see your ad; days are in UTC.</p>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────── payments ─────────────────────────────── */

const PAY_TONE: Record<string, "emerald" | "indigo" | "amber" | "rose" | "slate"> = { success: "emerald", pending: "indigo", verification_required: "amber", mismatch: "amber", failed: "rose", abandoned: "slate", expired: "slate", refunded: "slate", partially_refunded: "slate", chargeback: "rose" };
const PAY_TEXT: Record<string, string> = { success: "Paid", pending: "Pending", verification_required: "Verifying", mismatch: "Under review", failed: "Failed", abandoned: "Cancelled", expired: "Expired", refunded: "Refunded", partially_refunded: "Partly refunded", chargeback: "Disputed" };

export function PaymentList({ rows, onOpen }: { rows: PaymentRow[]; onOpen?: (id: string) => void }) {
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-muted-foreground">No payments yet.</p>;
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((p) => (
        <li key={p.reference} className="flex flex-wrap items-start justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tabular-nums">
              {usd(p.usd_cents)}
              {p.provider_currency && p.provider_currency !== "USD" && p.provider_amount ? <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">({p.provider_currency} {(p.provider_amount / 100).toLocaleString()})</span> : null}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {p.kind === "extension" ? "Campaign extension" : "Campaign payment"} · {p.provider === "bachs" ? "Card" : p.provider === "paystack" ? "Paystack" : p.provider} · {date(p.created_at)}
              {p.bonus_days ? ` · +${p.bonus_days} bonus days` : ""}
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{p.reference}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Chip tone={PAY_TONE[p.status] ?? "slate"}>{PAY_TEXT[p.status] ?? p.status}</Chip>
            {p.campaign_id && onOpen ? (
              <button type="button" onClick={() => onOpen(p.campaign_id!)} className="text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300">View campaign</button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Payments({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const rows: PaymentRow[] | null = useDash(`payments:${page}`, () => loadPayments(page)).data ?? null;
  return (
    <AiPanel>
      <p className="text-[14px] font-semibold">Payment history</p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">Confirmed by the payment provider — never by your browser.</p>
      <div className="mt-2">{rows ? <PaymentList rows={rows} onOpen={onOpen} /> : <Skeleton />}</div>
      {rows && (page > 0 || rows.length === 25) ? (
        <div className="mt-2 flex justify-center gap-3 text-[13px]">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="min-h-[2.5rem] rounded-full bg-secondary px-4 font-semibold disabled:opacity-40">Newer</button>
          <button type="button" disabled={rows.length < 25} onClick={() => setPage((p) => p + 1)} className="min-h-[2.5rem] rounded-full bg-secondary px-4 font-semibold disabled:opacity-40">Older</button>
        </div>
      ) : null}
    </AiPanel>
  );
}

/* ─────────────────────────────── help ─────────────────────────────── */

const HELP: { q: string; a: string }[] = [
  { q: "Can I change a live ad?", a: "Yes. Open the campaign and replace the image or video, or edit the headline, description or link. Your current ad keeps showing while the new version is checked, and is replaced only if it passes. Your dates and payment don't change." },
  { q: "Does editing cost anything?", a: "No. Changing the creative, the words or the link is free. Only adding days (an extension) is a new payment, and you see the exact price first." },
  { q: "How do I run my ad longer?", a: "Open a live or paused campaign and choose Extend. You pay for the extra days only; the end date moves after the payment is confirmed. The campaign, its start date and its place stay the same." },
  { q: "What is a view?", a: "A view counts once, when at least half of your ad stays on screen for a full second. Loading the page is not a view, and your own previews here never count." },
  { q: "Can I pause my ad?", a: "Yes, a live campaign can be paused and resumed. Pausing does not stop the clock — the campaign still ends on its end date." },
];

function Help() {
  return (
    <div className="space-y-3">
      <AiPanel>
        <p className="text-[14px] font-semibold">Advertising Rules</p>
        <p className="mt-1 text-[13px] text-muted-foreground">What can and can&apos;t be advertised, and how we check ads.</p>
        <TapOnceLink href="/advertise/rules" className="mt-2 inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">
          Read the rules →
        </TapOnceLink>
      </AiPanel>
      <AiPanel className="divide-y divide-border/60 p-0 sm:p-0">
        {HELP.map(({ q, a }) => (
          <details key={q} className="group px-4 py-3">
            <summary className="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">{q}</summary>
            <p className="pb-1 text-[13px] leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </AiPanel>
    </div>
  );
}
