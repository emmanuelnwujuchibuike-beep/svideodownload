"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { useShownOnce } from "./use-shown-once";

/**
 * Admin → Ads → Delivery monitor (Part 3, 0242). Guaranteed-views obligations
 * at a glance: the cards, one page of campaigns with filters, per-placement
 * capacity, and one campaign's delivery with the audited actions.
 *
 * Loads when the tab is first shown; filters apply on "Apply" (never per
 * keystroke); one page of 20 at a time; no polling — "Refresh" re-reads.
 * Measured figures and estimates are labelled apart, and a figure with no
 * data says "not enough data" instead of a number.
 */

type Summary = Record<string, number | string>;
interface Row {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  pricing_model: string;
  target_views: number | null;
  total_amount_minor: number | null;
  created_at: string;
  end_at: string | null;
  version: number;
  placement_name: string;
  business_name: string;
  phase: string | null;
  delivered_views: number | null;
  initial_end_at: string | null;
  extensions_used: number | null;
  max_extensions: number | null;
  admin_extra_days: number | null;
  last_credit_at: string | null;
  close_reason: string | null;
}
interface Capacity {
  window_days: number;
  completion_rate: number | null;
  extension_rate: number | null;
  avg_extension_days: number | null;
  closed_campaigns: number;
  placements: { code: string; name: string; daily_views: number | null; history_days: number; guaranteed_share: number | null; open_campaigns: number; outstanding_views: number; late_campaigns: number; estimated_days: number | null }[];
}
type Overview = { migrated: false; reason: string } | { migrated: true; summary: Summary; list: { total: number; rows: Row[] }; capacity: Capacity; pageSize: number };
interface Filters {
  model?: string;
  phase?: string;
  status?: string;
  placement?: string;
  advertiser?: string;
  deadline_before?: string;
  progress_below?: number;
}

const box = "rounded-2xl border border-border/70 bg-card p-4";
const fmt = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US"));
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const usd = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(2)}`);
const pct = (r: number | null | undefined) => (r === null || r === undefined ? "not enough data" : `${Math.round(Number(r) * 100)}%`);
const PHASE: Record<string, string> = { initial: "Planned period", extended: "Extended", review: "Needs a decision", fulfilled: "Fulfilled", shortfall: "Closed short" };

export function AdDeliveryMonitor() {
  const { ref, shown } = useShownOnce<HTMLDivElement>();
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Filters>({ model: "views_based" });
  const [filters, setFilters] = useState<Filters>({ model: "views_based" });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(f: Filters = filters, p: number = page) {
    setLoading(true);
    setError(null);
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));
    const res = await fetch(`/api/admin/ads/delivery?f=${encodeURIComponent(JSON.stringify(clean))}&page=${p}`, { cache: "no-store" }).catch(() => null);
    setLoading(false);
    if (!res?.ok) return setError("Couldn't load delivery. Try Refresh.");
    setData((await res.json()) as Overview);
  }

  useEffect(() => {
    if (shown) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const apply = () => {
    setFilters(draft);
    setPage(0);
    void load(draft, 0);
  };

  return (
    <div ref={ref} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Guaranteed-views obligations. Counts are qualifying views; estimates are marked.</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="min-h-[2.25rem] rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
      {!data ? <p className="text-xs text-muted-foreground">Loading…</p> : !data.migrated ? (
        <p className="text-xs text-muted-foreground">The delivery monitor appears once migration 0242 has run.</p>
      ) : (
        <>
          <Cards s={data.summary} />
          <section className={box}>
            <h3 className="text-sm font-semibold">Campaigns</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Select label="Pricing" value={draft.model ?? ""} onChange={(v) => setDraft({ ...draft, model: v || undefined })} options={[["", "Both"], ["views_based", "Views"], ["fixed_period", "Days"]]} />
              <Select label="Delivery" value={draft.phase ?? ""} onChange={(v) => setDraft({ ...draft, phase: v || undefined })} options={[["", "Any"], ...Object.entries(PHASE)]} />
              <Select label="Status" value={draft.status ?? ""} onChange={(v) => setDraft({ ...draft, status: v || undefined })} options={[["", "Any"], ["active", "Live"], ["paused", "Paused"], ["validating", "Validating"], ["completed", "Completed"], ["expired", "Expired"]]} />
              <Select label="Progress" value={draft.progress_below === undefined ? "" : String(draft.progress_below)} onChange={(v) => setDraft({ ...draft, progress_below: v ? Number(v) : undefined })} options={[["", "Any"], ["0.25", "Under 25%"], ["0.5", "Under 50%"], ["0.75", "Under 75%"]]} />
              <label className="text-[11.5px] text-muted-foreground">
                Advertiser
                <input value={draft.advertiser ?? ""} onChange={(e) => setDraft({ ...draft, advertiser: e.target.value || undefined })} onKeyDown={(e) => e.key === "Enter" && apply()} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
              </label>
              <label className="text-[11.5px] text-muted-foreground">
                Placement code
                <input value={draft.placement ?? ""} onChange={(e) => setDraft({ ...draft, placement: e.target.value.trim() || undefined })} placeholder="feed_banner" className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
              </label>
              <label className="text-[11.5px] text-muted-foreground">
                Planned end before
                <input type="date" value={draft.deadline_before?.slice(0, 10) ?? ""} onChange={(e) => setDraft({ ...draft, deadline_before: e.target.value ? new Date(e.target.value).toISOString() : undefined })} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
              </label>
              <div className="flex items-end">
                <button type="button" onClick={apply} disabled={loading} className="min-h-[2.25rem] w-full rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                  Apply
                </button>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-border/60">
              {data.list.rows.map((r) => (
                <li key={r.id} className="py-2.5">
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-start gap-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.name}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {r.business_name} · {r.placement_name} · {r.pricing_model === "views_based" ? "Views" : "Days"} · {r.status}
                      </span>
                      {r.target_views ? <Progress done={r.delivered_views ?? 0} target={r.target_views} /> : null}
                    </span>
                    <span className="shrink-0 text-right text-[11.5px]">
                      {r.phase ? <span className={cn("block font-semibold", r.phase === "review" ? "text-amber-700" : "text-muted-foreground")}>{PHASE[r.phase] ?? r.phase}</span> : null}
                      <span className="block text-muted-foreground">ends {day(r.end_at)}</span>
                    </span>
                  </button>
                  {open === r.id ? <Detail row={r} onChanged={() => void load()} /> : null}
                </li>
              ))}
              {data.list.rows.length === 0 ? <li className="py-3 text-xs text-muted-foreground">No campaigns match.</li> : null}
            </ul>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {fmt(data.list.total)} campaigns · page {page + 1} of {Math.max(1, Math.ceil(data.list.total / data.pageSize))}
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={page === 0 || loading} onClick={() => { setPage(page - 1); void load(filters, page - 1); }} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
                  Previous
                </button>
                <button type="button" disabled={(page + 1) * data.pageSize >= data.list.total || loading} onClick={() => { setPage(page + 1); void load(filters, page + 1); }} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
                  Next
                </button>
              </span>
            </div>
          </section>
          <CapacityTable c={data.capacity} />
        </>
      )}
    </div>
  );
}

function Cards({ s }: { s: Summary }) {
  const cards: [string, string, boolean?][] = [
    ["Active views campaigns", fmt(s.active)],
    ["In the planned period", fmt(s.initial)],
    ["In free extension", fmt(s.extended)],
    ["Need a decision", fmt(s.review), Number(s.review) > 0],
    ["Outstanding views", fmt(s.outstanding_views)],
    ["Views delivered, last 7 days", fmt(s.views_in_period)],
    ["Fulfilled", fmt(s.fulfilled)],
    ["Closed short", fmt(s.shortfall)],
    ["Planned end within 48 h", fmt(s.deadline_soon)],
    ["Past the planned period", fmt(s.overdue)],
    ["No views in 24 h", fmt(s.low_delivery), Number(s.low_delivery) > 0],
    ["Need attention", fmt(s.needs_attention), Number(s.needs_attention) > 0],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map(([label, value, warn]) => (
        <div key={label} className={cn("rounded-2xl border bg-card px-3 py-2.5", warn ? "border-amber-300" : "border-border/70")}>
          <p className="text-lg font-bold tabular-nums">{value}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

function Progress({ done, target }: { done: number; target: number }) {
  const share = Math.min(1, done / target);
  return (
    <span className="mt-1.5 flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {fmt(done)} / {fmt(target)} · {Math.floor(share * 100)}%
      </span>
    </span>
  );
}

function CapacityTable({ c }: { c: Capacity }) {
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Delivery health and capacity</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Measured over the last {c.window_days} complete days. &ldquo;Days to deliver&rdquo; is an estimate: outstanding views ÷ measured daily views of the whole placement.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <p>Completion rate <strong className="block text-sm">{pct(c.completion_rate)}</strong></p>
        <p>Needed an extension <strong className="block text-sm">{pct(c.extension_rate)}</strong></p>
        <p>Average extension <strong className="block text-sm">{c.avg_extension_days === null ? "not enough data" : `${c.avg_extension_days} days`}</strong></p>
        <p>Closed campaigns <strong className="block text-sm">{fmt(c.closed_campaigns)}</strong></p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1.5 font-semibold">Placement</th>
              <th className="py-1.5 font-semibold">Daily views (measured)</th>
              <th className="py-1.5 font-semibold">Sold as guarantees</th>
              <th className="py-1.5 font-semibold">Open</th>
              <th className="py-1.5 font-semibold">Outstanding</th>
              <th className="py-1.5 font-semibold">Days to deliver (est.)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {c.placements.map((p) => (
              <tr key={p.code} className={cn(p.estimated_days !== null && p.estimated_days > 30 && "text-amber-800")}>
                <td className="py-1.5">{p.name}</td>
                <td className="py-1.5 tabular-nums">{p.daily_views === null ? "not enough data" : fmt(p.daily_views)}</td>
                <td className="py-1.5 tabular-nums">{p.guaranteed_share === null ? "—" : pct(p.guaranteed_share)}</td>
                <td className="py-1.5 tabular-nums">
                  {fmt(p.open_campaigns)}
                  {p.late_campaigns ? ` (${p.late_campaigns} late)` : ""}
                </td>
                <td className="py-1.5 tabular-nums">{fmt(p.outstanding_views)}</td>
                <td className="py-1.5 tabular-nums">{p.outstanding_views === 0 ? "—" : p.estimated_days === null ? "not enough data" : `about ${fmt(p.estimated_days)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface DetailData {
  delivery: Record<string, unknown> | null;
  creatives: { id: string; status: string; validation: string; link: string; moderation: string | null }[];
  days: { day: string; views: number; filtered: number }[];
  adjustments: { delta: number; reason_code: string; note: string; before_views: number; after_views: number; created_at: string }[];
  open_flags: number;
  events: { kind: string; actor_role: string; reason: string | null; created_at: string }[];
}

function Detail({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [d, setD] = useState<DetailData | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [delta, setDelta] = useState(0);
  const [code, setCode] = useState("invalid_traffic_removed");

  async function reload() {
    const res = await fetch(`/api/admin/ads/delivery?id=${row.id}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setD((await res.json()) as DetailData);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  async function post(url: string, body: unknown, ok: string) {
    setBusy(true);
    setNote(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string; reason?: string } | null;
    setBusy(false);
    if (!res?.ok) return setNote({ ok: false, text: j?.error ?? "Couldn't do that." });
    setNote({ ok: true, text: ok });
    setReason("");
    await reload();
    onChanged();
  }

  const views = row.pricing_model === "views_based";
  const del = d?.delivery as { target_views?: number; delivered_views?: number; phase?: string; initial_end_at?: string; extension_days?: number; extensions_used?: number; max_extensions?: number; last_credit_at?: string | null; fulfilled_at?: string | null } | null | undefined;
  const reasonOk = reason.trim().length >= 5;
  return (
    <div className="mt-2 space-y-3 rounded-xl bg-secondary/40 p-3 text-xs">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <Item k="Campaign ID" v={<span className="break-all font-mono text-[10.5px]">{row.id}</span>} />
        <Item k="Advertiser" v={row.business_name} />
        <Item k="Pricing" v={views ? "Views" : "Days"} />
        <Item k="Price paid" v={usd(row.total_amount_minor)} />
        <Item k="Placement" v={row.placement_name} />
        <Item k="Status" v={`${row.status}${row.status_reason ? ` (${row.status_reason})` : ""}`} />
        {views && del ? (
          <>
            <Item k="Target" v={fmt(del.target_views)} />
            <Item k="Delivered (qualifying)" v={fmt(del.delivered_views)} />
            <Item k="Remaining" v={fmt((del.target_views ?? 0) - (del.delivered_views ?? 0))} />
            <Item k="Planned period ended" v={day(del.initial_end_at ?? null)} />
            <Item k="Current deadline" v={day(row.end_at)} />
            <Item k="Extensions" v={`${del.extensions_used ?? 0} of ${del.max_extensions ?? 0} × ${del.extension_days ?? 0} days${row.admin_extra_days ? ` + ${row.admin_extra_days} by admin` : ""}`} />
            <Item k="Last credited view" v={del.last_credit_at ? new Date(del.last_credit_at).toLocaleString() : "none yet"} />
            <Item k="Open traffic flags" v={fmt(d?.open_flags ?? 0)} />
          </>
        ) : null}
      </dl>
      {d ? (
        <>
          <p className="font-semibold">
            Creative:{" "}
            {d.creatives.map((c) => `${c.validation} file · ${c.link} link${c.moderation ? ` · ${c.moderation}` : ""}`).join(" | ") || "none"}
          </p>
          <div>
            <p className="font-semibold">Last 14 days (daily counters — counted / filtered)</p>
            <p className="mt-0.5 text-muted-foreground">{d.days.length ? d.days.map((x) => `${day(x.day)} ${fmt(x.views)}/${fmt(x.filtered)}`).join(" · ") : "no views yet"}</p>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">Loading…</p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-2">
        <label className="block">
          Reason (goes in the audit trail)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <div className="flex flex-wrap gap-2">
          {row.status === "active" ? (
            <button type="button" disabled={busy || !reasonOk} onClick={() => void post("/api/admin/ads/campaigns", { id: row.id, action: "pause", version: row.version, reason }, "Paused.")} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
              Pause
            </button>
          ) : null}
          {row.status === "paused" ? (
            <button type="button" disabled={busy} onClick={() => void post("/api/admin/ads/campaigns", { id: row.id, action: "resume", version: row.version, reason: reason || null }, "Resumed (or sent for a check).")} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
              Resume
            </button>
          ) : null}
          {views && del && ["initial", "extended", "review"].includes(del.phase ?? "") ? (
            <>
              <span className="inline-flex items-center gap-1">
                <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-14 rounded-lg border border-border bg-background px-2 py-1.5" aria-label="Days" />
                <button type="button" disabled={busy || !reasonOk || days < 1 || days > 90} onClick={() => void post("/api/admin/ads/delivery", { action: "extend", campaignId: row.id, days, reason }, `Extended by ${days} days.`)} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
                  Extend delivery
                </button>
              </span>
              <button type="button" disabled={busy || !reasonOk} onClick={() => confirm("Close this delivery and record the undelivered share as owed?") && void post("/api/admin/ads/delivery", { action: "close_refund", campaignId: row.id, reason }, "Closed — the refund is owed (Refunds owed).")} className="min-h-[2.25rem] rounded-lg border border-rose-300 px-3 font-semibold text-rose-700 disabled:opacity-40">
                Close with refund
              </button>
              <button type="button" disabled={busy} onClick={() => void post("/api/admin/ads/delivery", { action: "recheck", campaignId: row.id }, "Rechecked.")} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
                Recheck deadline
              </button>
            </>
          ) : null}
        </div>
        {views && del && ["initial", "extended", "review"].includes(del.phase ?? "") ? (
          <div className="flex flex-wrap items-end gap-2">
            <label>
              Correction
              <select value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-2 py-1.5">
                <option value="invalid_traffic_removed">Remove invalid traffic (−)</option>
                <option value="verified_dispute_credit">Verified dispute credit (+)</option>
                <option value="processing_error_correction">Processing error (±)</option>
              </select>
            </label>
            <label>
              Views (±)
              <input type="number" value={delta} onChange={(e) => setDelta(Math.trunc(Number(e.target.value)))} className="mt-1 block w-24 rounded-lg border border-border bg-background px-2 py-1.5" />
            </label>
            <button type="button" disabled={busy || !reasonOk || delta === 0} onClick={() => void post("/api/admin/ads/delivery", { action: "adjust", campaignId: row.id, delta, reasonCode: code, note: reason }, "Correction recorded.")} className="min-h-[2.25rem] rounded-lg border border-border px-3 font-semibold disabled:opacity-40">
              Record correction
            </button>
          </div>
        ) : null}
        {note ? <p className={cn("font-medium", note.ok ? "text-emerald-700" : "text-rose-700")}>{note.text}</p> : null}
      </div>

      {d?.adjustments.length ? (
        <div>
          <p className="font-semibold">Corrections</p>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {d.adjustments.map((a) => (
              <li key={a.created_at}>
                {new Date(a.created_at).toLocaleString()} · {a.reason_code} {a.delta > 0 ? `+${a.delta}` : a.delta} ({a.before_views}→{a.after_views}) · {a.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d?.events.length ? (
        <div>
          <p className="font-semibold">Audit</p>
          <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto text-muted-foreground">
            {d.events.map((e, i) => (
              <li key={i}>
                {new Date(e.created_at).toLocaleString()} · {e.kind} · {e.actor_role}
                {e.reason ? ` · ${e.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="text-[11.5px] text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
