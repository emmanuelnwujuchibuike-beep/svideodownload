"use client";

import { useEffect, useState } from "react";

import { ADVERTISER_STATUSES, type AdminCampaignView, FLAG_WORDS, type ModerationAction } from "@/lib/ads-platform/admin-shared";
import { cn } from "@/lib/utils";

import { useShownOnce } from "./use-shown-once";

/**
 * Admin → Ads → Campaigns (Ad Platform Part 7). The review desk for self-serve
 * campaigns: what waits on a person, what is live, what is owed back, and the
 * advertisers behind them. Every button is one database decision under the
 * version the admin saw (0204); a stale view answers "changed — reloaded".
 * Loads when the tab is first shown, then only on a view change or Refresh.
 */

interface Creative {
  id: string;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  headline: string | null;
  description: string | null;
  destinationUrl: string | null;
  validationStatus: string;
  validationErrors: string[];
  urlStatus: string;
  urlBlockReason: string | null;
}
interface Campaign {
  statsMultiplier: number;
  id: string;
  name: string;
  status: string;
  statusReason: string | null;
  version: number;
  advertiser: { id: string; name: string; status: string } | null;
  placement: { code: string; name: string; format: string } | null;
  durationDays: number | null;
  extraDays: number;
  currency: string | null;
  totalMinor: number | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  createdAt: string;
  startAt: string | null;
  endAt: string | null;
  flags: string[];
  refund: { status: string; owedMinor: number | null; note: string | null; decidedAt: string | null };
  creatives: Creative[];
  impressions: number;
  clicks: number;
  actions: ModerationAction[];
}
interface Advertiser {
  id: string;
  businessName: string;
  displayName: string;
  contactEmail: string | null;
  website: string | null;
  status: string;
  statusReason: string | null;
  createdAt: string;
  campaigns: number;
  live: number;
}
interface Event {
  kind: string;
  from: string | null;
  to: string | null;
  role: string;
  reason: string | null;
  at: string;
}

type Tab = AdminCampaignView | "advertisers";
const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "Needs review" },
  { id: "live", label: "Live & paused" },
  { id: "refunds", label: "Refunds owed" },
  { id: "all", label: "All" },
  { id: "advertisers", label: "Advertisers" },
];

const ACTION_LABEL: Record<ModerationAction, string> = { approve: "Approve", reject: "Reject", pause: "Pause", resume: "Resume", remove: "Remove" };
const NEEDS_REASON: ModerationAction[] = ["reject", "remove"];

const TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-800",
  validating: "bg-sky-50 text-sky-700",
  paid: "bg-sky-50 text-sky-700",
  rejected: "bg-rose-50 text-rose-700",
  removed: "bg-rose-50 text-rose-700",
  expired: "bg-slate-100 text-slate-600",
};

const money = (minor: number | null, cur: string | null) => (minor === null || !cur ? "—" : `${cur === "USD" ? "$" : cur === "NGN" ? "₦" : `${cur} `}${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const when = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const REASON_WORDS: Record<string, string> = {
  stale: "This campaign changed since you loaded it. Reloaded — check it and try again.",
  reason_required: "Write a reason — the advertiser sees it.",
  bad_status: "That action doesn't fit this campaign's status any more.",
  transition_not_allowed: "That move isn't allowed from this status.",
  not_owed: "No refund is owed on this campaign.",
  not_found: "Campaign not found.",
};

export function AdCampaignsDesk() {
  const { ref, shown } = useShownOnce<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>("review");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [counts, setCounts] = useState<Record<AdminCampaignView, number> | null>(null);
  const [advertisers, setAdvertisers] = useState<Advertiser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function load(next: Tab = tab, term = q) {
    setBusy("load");
    const url = next === "advertisers" ? `/api/admin/ads/advertisers?q=${encodeURIComponent(term)}` : `/api/admin/ads/campaigns?view=${next}&q=${encodeURIComponent(term)}`;
    const res = await fetch(url, { cache: "no-store" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ tone: "bad", text: "Couldn't load. Try Refresh." });
    if (next === "advertisers") {
      setAdvertisers(((await res.json()) as { advertisers: Advertiser[] }).advertisers);
    } else {
      const d = (await res.json()) as { rows: Campaign[]; counts: Record<AdminCampaignView, number> };
      setRows(d.rows);
      setCounts(d.counts);
    }
  }

  useEffect(() => {
    if (shown) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a view change reloads explicitly
  }, [shown]);

  function pick(t: Tab) {
    setTab(t);
    setNote(null);
    void load(t);
  }

  async function post(url: string, body: unknown, key: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setNote(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(null);
    const out = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res) setNote({ tone: "bad", text: "No connection. Nothing changed." });
    return out ?? { ok: false, reason: "error" };
  }

  async function moderate(c: Campaign, action: ModerationAction, reason: string) {
    const out = await post("/api/admin/ads/campaigns", { id: c.id, action, version: c.version, reason: reason || null }, `${c.id}:${action}`);
    if (!out) return;
    if (out.ok) {
      const owed = Number(out.refund_owed ?? 0);
      setNote({ tone: "ok", text: `${ACTION_LABEL[action]}: “${c.name}” — done.${owed > 0 ? ` ${money(owed, (out.currency as string) ?? c.currency)} is owed back (see Refunds owed).` : ""}` });
    } else if (out.reason === "flagged") {
      const flags = (out.flags as string[] | undefined) ?? [];
      setNote({ tone: "bad", text: `Still waiting: ${flags.map((f) => FLAG_WORDS[f] ?? f).join(" · ") || "a check failed"}.` });
    } else {
      setNote({ tone: "bad", text: REASON_WORDS[String(out.reason)] ?? String(out.error ?? "That didn't go through. Nothing changed.") });
    }
    void load();
  }

  async function setBoost(c: Campaign, statsMultiplier: 1 | 10) {
    const out = await post("/api/admin/ads/campaigns", { id: c.id, statsMultiplier }, `${c.id}:boost`);
    if (!out) return;
    setNote(out.ok ? { tone: "ok", text: statsMultiplier === 10 ? `Sample-data ×10 ON: “${c.name}” shows ×10 views, clicks and conversions on its dashboard.` : `Sample-data ×10 OFF: “${c.name}” shows real figures.` } : { tone: "bad", text: "That didn't go through. Nothing changed (has migration 0212 been run?)." });
    void load();
  }

  async function setBoostAllLive(statsMultiplier: 1 | 10) {
    if (!window.confirm(statsMultiplier === 10 ? "Show ×10 sample data on the dashboard of EVERY live campaign? (Display only — stored counts, billing and refunds are untouched.)" : "Show real figures on every live campaign's dashboard?")) return;
    const out = await post("/api/admin/ads/campaigns", { allLive: true, statsMultiplier }, "boost-all");
    if (!out) return;
    const changed = Number(out.changed ?? 0);
    const failed = Number(out.failed ?? 0);
    setNote(
      out.ok
        ? { tone: "ok", text: changed === 0 ? `Every live campaign already shows ${statsMultiplier === 10 ? "×10 sample data" : "real figures"}.` : `Sample-data ×10 ${statsMultiplier === 10 ? "ON" : "OFF"} for ${changed} live campaign(s).` }
        : { tone: "bad", text: failed > 0 ? `${changed} changed, ${failed} didn't go through. Try again.` : "That didn't go through. Nothing changed (has migration 0212 been run?)." },
    );
    void load();
  }

  async function decideRefund(c: Campaign, refund: "refunded" | "waived", text: string) {
    const out = await post("/api/admin/ads/campaigns", { id: c.id, refund, note: text || null }, `${c.id}:refund`);
    if (!out) return;
    setNote(out.ok ? { tone: "ok", text: refund === "refunded" ? `Marked refunded: “${c.name}”.` : `Refund waived: “${c.name}”.` } : { tone: "bad", text: REASON_WORDS[String(out.reason)] ?? "That didn't go through." });
    void load();
  }

  async function setStatus(a: Advertiser, status: string, reason: string) {
    const out = await post("/api/admin/ads/advertisers", { id: a.id, status, reason: reason || null }, `adv:${a.id}`);
    if (!out) return;
    setNote(
      out.ok
        ? { tone: "ok", text: `${a.businessName} is now ${status}.${Number(out.paused ?? 0) > 0 ? ` ${String(out.paused)} live campaign(s) paused.` : ""}` }
        : { tone: "bad", text: out.reason === "reason_required" ? "Write a reason for anything but active." : "That didn't go through." },
    );
    void load();
  }

  return (
    <div ref={ref} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition", tab === t.id ? "bg-primary text-primary-foreground ring-primary" : "bg-card text-foreground ring-border hover:bg-muted")}
          >
            {t.label}
            {t.id !== "advertisers" && counts ? <span className="ml-1 tabular-nums opacity-80">{counts[t.id]}</span> : null}
          </button>
        ))}
        {tab !== "advertisers" ? (
          <div className="flex items-center gap-1.5" role="group" aria-label="Sample-data ×10 for all live campaigns">
            <span className="text-xs text-muted-foreground">All live ×10:</span>
            <button type="button" disabled={busy !== null} onClick={() => void setBoostAllLive(10)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
              {busy === "boost-all" ? "…" : "Turn on"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void setBoostAllLive(1)} className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
              Turn off
            </button>
          </div>
        ) : null}
        <form
          className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void load(tab, q);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "advertisers" ? "Business name" : "Campaign name"} className="min-w-0 flex-1 sm:w-40 sm:flex-none rounded-lg border border-border bg-background px-2 py-1.5 text-base sm:py-1 sm:text-xs" aria-label="Search" />
          <button type="submit" disabled={busy !== null} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
            {busy === "load" ? "Loading…" : "Refresh"}
          </button>
        </form>
      </div>

      {note ? <p className={cn("rounded-xl px-3 py-2 text-xs font-medium", note.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{note.text}</p> : null}

      {tab === "advertisers" ? (
        advertisers === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : advertisers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No advertisers yet.</p>
        ) : (
          <ul className="space-y-2">
            {advertisers.map((a) => (
              <AdvertiserRow key={a.id} a={a} busy={busy === `adv:${a.id}`} onSave={(s, r) => void setStatus(a, s, r)} />
            ))}
          </ul>
        )
      ) : rows === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tab === "review" ? "Nothing waiting on a review." : tab === "refunds" ? "No refunds owed." : "No campaigns here."}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <CampaignCard key={c.id} c={c} busy={busy} onModerate={(a, r) => void moderate(c, a, r)} onRefund={(s, t) => void decideRefund(c, s, t)} onBoost={(m) => void setBoost(c, m)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({ c, busy, onModerate, onRefund, onBoost }: { c: Campaign; busy: string | null; onBoost: (m: 1 | 10) => void; onModerate: (a: ModerationAction, reason: string) => void; onRefund: (s: "refunded" | "waived", note: string) => void }) {
  const [reason, setReason] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [events, setEvents] = useState<Event[] | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const ctr = c.impressions > 0 ? `${((c.clicks / c.impressions) * 100).toFixed(1)}%` : "—";

  async function toggleEvents() {
    const next = !showEvents;
    setShowEvents(next);
    if (next && events === null) {
      const res = await fetch(`/api/admin/ads/campaigns?events=${c.id}`, { cache: "no-store" }).catch(() => null);
      setEvents(res?.ok ? ((await res.json()) as { events: Event[] }).events : []);
    }
  }

  return (
    <li className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{c.name}</p>
          <p className="break-words text-[11.5px] text-muted-foreground">
            {c.advertiser ? (
              <>
                {c.advertiser.name}
                {c.advertiser.status !== "active" ? <span className="ml-1 font-semibold text-rose-600">({c.advertiser.status})</span> : null}
              </>
            ) : (
              "Unknown advertiser"
            )}{" "}
            · {c.placement?.name ?? "—"} <span className="opacity-70">({c.placement?.format ?? "?"})</span> · {c.durationDays ?? "?"} days{c.extraDays ? ` + ${c.extraDays}` : ""}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[c.status] ?? "bg-slate-100 text-slate-700")}>{c.status}</span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-4 [&>div]:min-w-0">
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-medium tabular-nums">
            {money(c.totalMinor, c.currency)} {c.paidAt ? <span className="text-muted-foreground">· {c.paymentMethod ?? ""}</span> : <span className="text-amber-700">· unpaid</span>}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Runs</dt>
          <dd className="font-medium">
            {when(c.startAt)} → {when(c.endAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Impressions · clicks</dt>
          <dd className="font-medium tabular-nums">
            {c.impressions.toLocaleString("en-US")} · {c.clicks.toLocaleString("en-US")} <span className="text-muted-foreground">({ctr})</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reference</dt>
          <dd className="truncate font-mono text-[10.5px]">{c.paymentReference ?? "—"}</dd>
        </div>
      </dl>

      {c.statusReason ? <p className="mt-2 text-[11.5px] text-muted-foreground">Reason on record: {c.statusReason}</p> : null}
      {c.flags.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {c.flags.map((f) => (
            <li key={f} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {FLAG_WORDS[f] ?? f}
            </li>
          ))}
        </ul>
      ) : null}

      {c.creatives.length ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {c.creatives.map((cr) => (
            <div key={cr.id} className="flex min-w-0 gap-3 rounded-xl bg-muted/40 p-2">
              <div className="h-16 w-16 shrink-0 sm:h-20 sm:w-20 overflow-hidden rounded-lg bg-muted">
                {cr.mediaType === "video" && cr.mediaUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption -- an advertiser's ad, previewed silently by an admin
                  <video src={cr.mediaUrl} poster={cr.thumbnailUrl ?? undefined} preload="none" controls muted playsInline className="h-full w-full object-cover" />
                ) : cr.thumbnailUrl || cr.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote creative preview, admin-only
                  <img src={(cr.thumbnailUrl ?? cr.mediaUrl)!} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-[10px] text-muted-foreground">No media</span>
                )}
              </div>
              <div className="min-w-0 flex-1 text-[11.5px]">
                <p className="truncate font-semibold">{cr.headline ?? "No headline"}</p>
                {cr.description ? <p className="line-clamp-2 break-words text-muted-foreground">{cr.description}</p> : null}
                {cr.destinationUrl ? (
                  <a href={cr.destinationUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-primary underline">
                    {cr.destinationUrl}
                  </a>
                ) : (
                  <p className="text-rose-600">No link</p>
                )}
                <p className="mt-0.5 break-words text-muted-foreground">
                  Media: <strong className={cr.validationStatus === "valid" ? "text-emerald-700" : "text-amber-700"}>{cr.validationStatus}</strong> · Link:{" "}
                  <strong className={cr.urlStatus === "valid" ? "text-emerald-700" : "text-amber-700"}>{cr.urlStatus}</strong>
                  {cr.urlBlockReason ? ` (${cr.urlBlockReason})` : ""}
                  {cr.validationErrors.length ? ` · ${cr.validationErrors.join(", ")}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {c.refund.status !== "none" ? (
        <div className={cn("mt-3 rounded-xl p-3 text-[11.5px]", c.refund.status === "owed" ? "bg-violet-50 text-violet-900" : "bg-muted/50")}>
          <p className="font-semibold">
            Refund {c.refund.status}: {money(c.refund.owedMinor, c.currency)}
            {c.refund.decidedAt ? <span className="font-normal"> · {when(c.refund.decidedAt)}</span> : null}
          </p>
          {c.refund.note ? <p>{c.refund.note}</p> : null}
          {c.refund.status === "owed" ? (
            <>
              <p className="mt-1 opacity-80">Send it from the {c.paymentMethod ?? "payment"} dashboard (reference above), then mark it here. The provider&apos;s refund webhook also records it on the payment.</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} maxLength={300} placeholder="Note (provider refund id…)" className="w-full min-w-0 sm:w-auto sm:flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-base sm:py-1 sm:text-xs" />
                <button type="button" disabled={busy !== null} onClick={() => onRefund("refunded", refundNote)} className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
                  Mark refunded
                </button>
                <button type="button" disabled={busy !== null} onClick={() => onRefund("waived", refundNote)} className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
                  Waive
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {c.actions.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {c.actions.some((a) => NEEDS_REASON.includes(a)) ? (
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason — the advertiser sees it" className="w-full min-w-0 sm:w-auto sm:flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-base sm:py-1 sm:text-xs" aria-label="Reason" />
          ) : null}
          {c.actions.map((a) => {
            const needs = NEEDS_REASON.includes(a) && !reason.trim();
            return (
              <button
                key={a}
                type="button"
                disabled={busy !== null || needs}
                title={needs ? "Write a reason first" : undefined}
                onClick={() => {
                  if (a === "remove" && !window.confirm(`Remove “${c.name}”? It stops serving now and can't be undone.`)) return;
                  onModerate(a, reason.trim());
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50",
                  a === "approve" || a === "resume" ? "bg-emerald-600 text-white" : a === "pause" ? "bg-amber-500 text-white" : "bg-rose-600 text-white",
                )}
              >
                {busy === `${c.id}:${a}` ? "…" : ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col items-start gap-1.5 rounded-xl bg-muted/50 p-2.5 text-[11.5px] sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <span className="font-semibold">Dashboard sample data ×10</span>
        <span className="text-muted-foreground">Display only: the advertiser sees 10× views, clicks and conversions (labelled “Sample data”). Stored counts and billing stay real.</span>
        <button
          type="button"
          disabled={busy !== null}
          aria-pressed={c.statsMultiplier === 10}
          onClick={() => onBoost(c.statsMultiplier === 10 ? 1 : 10)}
          className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-60", c.statsMultiplier === 10 ? "bg-amber-500 text-white" : "border border-border bg-background")}
        >
          {busy === `${c.id}:boost` ? "…" : c.statsMultiplier === 10 ? "On · turn off" : "Off · turn on"}
        </button>
      </div>

      <button type="button" onClick={() => void toggleEvents()} className="mt-2 text-[11px] font-semibold text-muted-foreground underline">
        {showEvents ? "Hide history" : "History"}
      </button>
      {showEvents ? (
        events === null ? (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        ) : (
          <ol className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {events.map((e, i) => (
              <li key={i}>
                {when(e.at)} · <strong className="text-foreground">{e.kind}</strong>
                {e.from || e.to ? ` (${e.from ?? "—"} → ${e.to ?? "—"})` : ""} · {e.role}
                {e.reason ? ` · ${e.reason}` : ""}
              </li>
            ))}
            {events.length === 0 ? <li>No events.</li> : null}
          </ol>
        )
      ) : null}
    </li>
  );
}

function AdvertiserRow({ a, busy, onSave }: { a: Advertiser; busy: boolean; onSave: (status: string, reason: string) => void }) {
  const [status, setStatus] = useState(a.status);
  const [reason, setReason] = useState("");
  const changed = status !== a.status;
  return (
    <li className="rounded-2xl border border-border/70 bg-card p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {a.businessName} <span className="font-normal text-muted-foreground">· {a.displayName}</span>
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {a.contactEmail ?? "no contact email"}
            {a.website ? ` · ${a.website}` : ""} · {a.campaigns} campaign{a.campaigns === 1 ? "" : "s"}, {a.live} live
          </p>
          {a.statusReason ? <p className="text-[11.5px] text-rose-700">Reason: {a.statusReason}</p> : null}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-base sm:py-1 sm:text-xs" aria-label={`${a.businessName} status`}>
          {ADVERTISER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {changed ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {status !== "active" ? <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (required)" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-base sm:py-1 sm:text-xs" /> : null}
          <button type="button" disabled={busy || (status !== "active" && !reason.trim())} onClick={() => onSave(status, reason.trim())} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "…" : status === "active" ? "Reactivate" : `Set ${status}`}
          </button>
          {status !== "active" && a.live > 0 ? <span className="text-[11px] text-amber-700">Pauses {a.live} live campaign(s) now.</span> : null}
        </div>
      ) : null}
    </li>
  );
}
