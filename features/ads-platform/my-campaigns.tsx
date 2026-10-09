"use client";

import { BarChart3, CreditCard, HelpCircle, LayoutGrid, Megaphone, Plus, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  num,
  PAGE_SIZE,
  pct,
  remaining,
  statusLabel,
  totalsOf,
  usd,
  type CampaignRow,
  type PaymentRow,
  type SortKey,
  type StatRow,
  type Summary,
  type Totals,
} from "./dashboard/dashboard-data";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Dashboard sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => go({ tab: id === "overview" ? null : id })}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition",
                tab === id ? "bg-indigo-600 text-white" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </nav>
        <AiButtonLink tapOnce href="/advertise/create" prefetch={false} size="sm" icon={<Plus className="h-4 w-4" />}>
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
        <span key={i} className="block h-32 animate-pulse rounded-[1.75rem] bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-card p-3.5 ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-[1.35rem] font-bold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <AiPanel className="text-center">
      <Megaphone className="mx-auto h-6 w-6 text-indigo-600" aria-hidden />
      <p className="mt-2 text-[15px] font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
      <AiButtonLink tapOnce href="/advertise/create" prefetch={false} className="mt-4">
        Create Advertisement
      </AiButtonLink>
    </AiPanel>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <AiPanel className="text-center">
      <p className="text-[14px] font-semibold">We couldn&apos;t load this right now.</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-[2.75rem] text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
        Try again
      </button>
    </AiPanel>
  );
}

export function Thumb({ c }: { c: Pick<CampaignRow, "ad_creatives"> }) {
  const cr = liveCreative(c);
  // an image, or a video's poster — never the video itself in a list
  const src = cr ? (cr.media_type === "image" ? cr.media_url : cr.thumbnail_url) : null;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a CDN creative preview; previews are not ad views and record nothing
    <img src={src} alt="" loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-xl bg-muted object-cover" />
  ) : (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden>
      <Megaphone className="h-5 w-5" />
    </span>
  );
}

/* ─────────────────────────────── overview ─────────────────────────────── */

function Overview({ onOpen, onTab }: { onOpen: (id: string) => void; onTab: (t: Tab) => void }) {
  const [s, setS] = useState<Summary | null | "error">(null);
  const [recent, setRecent] = useState<CampaignRow[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadSummary().then((v) => alive && setS(v ?? "error"));
    void loadCampaigns({ search: "", statuses: null, sort: "newest", page: 0 }).then((r) => alive && setRecent(r.rows.slice(0, 3)));
    return () => {
      alive = false;
    };
  }, [n]);
  if (s === "error") return <Failed onRetry={() => setN((x) => x + 1)} />;
  if (!s) return <Skeleton />;
  if (s.total === 0) return <Empty title="No campaigns yet" body="Create your first ad — choose where it shows, upload it, see the price, and go live after payment." />;
  const ctr = s.impressions > 0 ? s.clicks / s.impressions : null;
  return (
    <div className="space-y-5">
      <section aria-labelledby="ov-perf">
        <h2 id="ov-perf" className="text-[13px] font-semibold text-muted-foreground">Performance, all time</h2>
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Total views" value={num(s.impressions)} hint="Seen on screen for at least a second" />
          <Stat label="Clicks" value={num(s.clicks)} />
          <Stat label="CTR" value={pct(ctr)} hint="Clicks ÷ views" />
          <Stat label="Spend" value={usd(s.spend_usd_cents)} hint="Verified payments" />
          {/* 0201 (owner, 2026-10-09): opening the ad's details on Frenzsave is a conversion; the visit after the warning is a site visit */}
          <Stat label="Conversions" value={num(s.conversions)} hint="Opened your ad's details" />
          <Stat label="Site visits" value={num(s.outbounds)} hint="Went on to your link" />
        </div>
      </section>
      <section aria-labelledby="ov-camp">
        <h2 id="ov-camp" className="text-[13px] font-semibold text-muted-foreground">Campaigns</h2>
        <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          <Stat label="Total" value={num(s.total)} />
          <Stat label="Live" value={num(s.live)} />
          <Stat label="Awaiting payment" value={num(s.awaiting_payment)} />
          <Stat label="Validating" value={num(s.validating)} />
          <Stat label="Paused" value={num(s.paused)} />
          <Stat label="Expired" value={num(s.expired)} />
        </div>
      </section>
      <section aria-labelledby="ov-recent">
        <div className="flex items-center justify-between">
          <h2 id="ov-recent" className="text-[13px] font-semibold text-muted-foreground">Recent</h2>
          <button type="button" onClick={() => onTab("campaigns")} className="min-h-[2.5rem] text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
            All campaigns →
          </button>
        </div>
        <div className="mt-1 space-y-2">{recent?.map((c) => <CampaignCard key={c.id} c={c} totals={null} onOpen={onOpen} />) ?? <Skeleton />}</div>
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

function CampaignCard({ c, totals, onOpen }: { c: CampaignRow; totals: Totals | null; onOpen: (id: string) => void }) {
  const l = statusLabel(c);
  const left = c.status === "active" || c.status === "paused" ? remaining(c.end_at) : null;
  return (
    <button type="button" onClick={() => onOpen(c.id)} className="block w-full text-left">
      <AiPanel className="transition hover:ring-indigo-200 dark:hover:ring-indigo-400/30">
        <div className="flex gap-3">
          <Thumb c={c} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-[15px] font-semibold">{c.name}</p>
              <Chip tone={l.tone}>{l.text}</Chip>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
              {c.ad_placements?.name ?? "—"} · {c.payment_verified_at ? "Paid" : c.status === "payment_processing" ? "Payment processing" : "Not paid"}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {date(c.start_at)} – {date(c.end_at)}
              {left ? ` · ${left}` : ""}
            </p>
            {totals ? (
              <p className="mt-1 text-[12.5px] tabular-nums">
                <span className="font-semibold">{num(totals.views)}</span> views · <span className="font-semibold">{num(totals.clicks)}</span> clicks · CTR {pct(totals.ctr)}
              </p>
            ) : null}
          </div>
        </div>
      </AiPanel>
    </button>
  );
}

function Campaigns({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState(0);
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ rows: CampaignRow[]; total: number; stats: Map<string, Totals> } | null | "error">(null);

  // search on a pause in typing — no request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(typed);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    let alive = true;
    setData(null);
    void (async () => {
      try {
        const r = await loadCampaigns({ search, statuses: FILTERS[filter]!.statuses, sort, page });
        const stats = await loadStats(r.rows.map((x) => x.id), null);
        if (alive) setData({ ...r, stats: byCampaign(stats) });
      } catch {
        if (alive) setData("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [search, filter, sort, page, attempt]);

  const pages = data && data !== "error" ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search campaigns</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by campaign name" className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-[14px]" />
        </label>
        <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(0); }} aria-label="Sort campaigns" className="h-11 rounded-xl border border-border bg-background px-3 text-[13.5px]">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="ending">Ending soonest</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f, i) => (
          <button key={f.label} type="button" role="tab" aria-selected={filter === i} onClick={() => { setFilter(i); setPage(0); }} className={cn("min-h-[2.25rem] shrink-0 rounded-full px-3 text-[12.5px] font-semibold", filter === i ? "bg-foreground text-background" : "bg-secondary text-muted-foreground")}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {data === "error" ? <Failed onRetry={() => setAttempt((x) => x + 1)} /> : !data ? <Skeleton /> : data.rows.length === 0 ? (
          search || filter ? <p className="py-8 text-center text-[13.5px] text-muted-foreground">No campaigns match.</p> : <Empty title="No campaigns yet" body="Your campaigns will appear here." />
        ) : (
          data.rows.map((c) => <CampaignCard key={c.id} c={c} totals={data.stats.get(c.id) ?? { views: 0, clicks: 0, ctr: null, videoPlays: 0, videoCompletes: 0, rewardCompletes: 0, conversions: 0, outbounds: 0 }} onOpen={onOpen} />)
        )}
      </div>
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-[13px]">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="min-h-[2.5rem] rounded-full bg-secondary px-4 font-semibold disabled:opacity-40">Previous</button>
          <span className="tabular-nums text-muted-foreground">Page {page + 1} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="min-h-[2.5rem] rounded-full bg-secondary px-4 font-semibold disabled:opacity-40">Next</button>
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

export function DayChart({ rows }: { rows: { day: string; views: number; clicks: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  if (!rows.length) return <p className="py-8 text-center text-[13px] text-muted-foreground">No views in this period yet.</p>;
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Views per day: ${rows.map((r) => `${r.day} ${r.views}`).join(", ")}`}>
        {rows.map((r) => (
          <div key={r.day} className="flex h-full flex-1 flex-col justify-end" title={`${r.day}: ${num(r.views)} views, ${num(r.clicks)} clicks`}>
            <div className="w-full rounded-t-[3px] bg-indigo-500/80" style={{ height: `${Math.max(2, (r.views / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{rows[0]!.day}</span>
        <span>{rows[rows.length - 1]!.day}</span>
      </div>
    </div>
  );
}

function Analytics({ onOpen }: { onOpen: (id: string) => void }) {
  const [range, setRange] = useState("30");
  const [rows, setRows] = useState<StatRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    setRows(null);
    const days = RANGES.find((r) => r.id === range)!.days;
    void Promise.all([loadStats(null, fromDay(days)), loadCampaigns({ search: "", statuses: null, sort: "newest", page: 0 })]).then(([s, c]) => {
      if (!alive) return;
      setRows(s);
      setNames(new Map(c.rows.map((x) => [x.id, x.name])));
    });
    return () => {
      alive = false;
    };
  }, [range]);
  const totals = useMemo(() => (rows ? totalsOf(rows) : null), [rows]);
  const per = useMemo(() => (rows ? [...byCampaign(rows)].sort((a, b) => b[1].views - a[1].views) : []), [rows]);
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)} className={cn("min-h-[2.25rem] rounded-full px-3 text-[12.5px] font-semibold", range === r.id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground")}>
            {r.label}
          </button>
        ))}
      </div>
      {!rows || !totals ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Total views" value={num(totals.views)} />
            <Stat label="Clicks" value={num(totals.clicks)} />
            <Stat label="CTR" value={pct(totals.ctr)} />
            <Stat label="Video completions" value={num(totals.videoCompletes + totals.rewardCompletes)} hint={totals.videoPlays ? `${num(totals.videoPlays)} plays` : undefined} />
            <Stat label="Conversions" value={num(totals.conversions)} hint="Opened your ad's details" />
            <Stat label="Site visits" value={num(totals.outbounds)} hint="Went on to your link" />
          </div>
          <AiPanel>
            <p className="text-[13px] font-semibold">Views per day</p>
            <div className="mt-3">
              <DayChart rows={byDay(rows)} />
            </div>
          </AiPanel>
          <AiPanel>
            <p className="text-[13px] font-semibold">By campaign</p>
            {per.length === 0 ? <p className="mt-2 text-[13px] text-muted-foreground">Nothing yet in this period.</p> : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[440px] text-left text-[13px]">
                  <thead className="text-[11.5px] text-muted-foreground">
                    <tr><th className="py-1.5 font-semibold">Campaign</th><th className="py-1.5 text-right font-semibold">Views</th><th className="py-1.5 text-right font-semibold">Clicks</th><th className="py-1.5 text-right font-semibold">CTR</th><th className="py-1.5 text-right font-semibold">Conversions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {per.map(([id, t]) => (
                      <tr key={id}>
                        <td className="py-2"><button type="button" onClick={() => onOpen(id)} className="max-w-[14rem] truncate text-left font-semibold text-indigo-700 dark:text-indigo-300">{names.get(id) ?? "Campaign"}</button></td>
                        <td className="py-2 text-right tabular-nums">{num(t.views)}</td>
                        <td className="py-2 text-right tabular-nums">{num(t.clicks)}</td>
                        <td className="py-2 text-right tabular-nums">{pct(t.ctr)}</td>
                        <td className="py-2 text-right tabular-nums">{num(t.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AiPanel>
          <p className="text-[12px] text-muted-foreground">A view counts once, when at least half of your ad stays on screen for a full second. Clicks open your link. Figures update as people see your ad; days are in UTC.</p>
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
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    void loadPayments(page).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [page]);
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
