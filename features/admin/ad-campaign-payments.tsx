"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Admin → Ads → Campaign payments (Part 3). Every ad payment from the shared
 * attempt ledger with its campaigns, the reconciliation flags, and two
 * idempotent repairs. Loads when the tab is first SHOWN (an inactive tab is
 * mounted but hidden), then only on Refresh or a filter change — never polled.
 */

interface Row {
  reference: string;
  provider: string;
  status: string;
  statusReason: string | null;
  usdCents: number;
  providerAmount: number | null;
  providerCurrency: string | null;
  fxMinorPerUsd: number | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  chargeId: string | null;
  createdAt: string;
  verifiedAt: string | null;
  refundedAmount: number | null;
  refundedAt: string | null;
  disputedAt: string | null;
  advertiser: string | null;
  campaigns: { id: string; name: string; status: string; activatedAt: string | null; startAt: string | null; endAt: string | null }[];
}
interface Flag {
  kind: string;
  reference: string | null;
  campaignId: string | null;
  detail: string;
  since: string | null;
}

const money = (minor: number | null, cur: string | null) => (minor === null || !cur ? "—" : `${cur === "USD" ? "$" : cur === "NGN" ? "₦" : `${cur} `}${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const when = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const TONE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700",
  pending: "bg-slate-100 text-slate-700",
  verification_required: "bg-amber-50 text-amber-800",
  mismatch: "bg-rose-50 text-rose-700",
  failed: "bg-rose-50 text-rose-700",
  refunded: "bg-violet-50 text-violet-700",
  partially_refunded: "bg-violet-50 text-violet-700",
  chargeback: "bg-rose-100 text-rose-800",
};

export function AdCampaignPayments() {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [filters, setFilters] = useState({ provider: "", status: "", campaignStatus: "", currency: "", advertiser: "", from: "", to: "" });
  const [data, setData] = useState<{ rows: Row[]; flags: Flag[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const load = async () => {
    setBusy(true);
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const res = await fetch(`/api/admin/ads/payments?${q}`).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote("Couldn't load ad payments.");
    setNote(null);
    setData((await res.json()) as { rows: Row[]; flags: Flag[] });
  };

  useEffect(() => {
    if (visible) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters reload explicitly with the Apply button
  }, [visible]);

  const act = async (reference: string, action: "recheck" | "activate") => {
    setBusy(true);
    const res = await fetch("/api/admin/ads/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference, action }) }).catch(() => null);
    setBusy(false);
    setNote(res?.ok ? `${action === "recheck" ? "Checked with the provider" : "Activation retried"}: ${reference}` : "Action failed.");
    void load();
  };

  const sel = (key: keyof typeof filters, options: string[], label: string) => (
    <label className="text-[11px] text-muted-foreground">
      {label}{" "}
      <select value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div ref={root} className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Payments for self-serve ad campaigns. The provider&apos;s signed webhook is the authority; a payment is never settled by the browser. Routing for ads is set in AI plans → Payment routing (&quot;Ad campaigns&quot;).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {sel("provider", ["bachs", "paystack"], "Provider")}
        {sel("status", ["pending", "success", "verification_required", "mismatch", "failed", "abandoned", "expired", "refunded", "partially_refunded", "chargeback"], "Payment")}
        {sel("campaignStatus", ["payment_processing", "paid", "validating", "active", "paused", "expired", "removed"], "Campaign")}
        {sel("currency", ["USD", "NGN"], "Currency")}
        <label className="text-[11px] text-muted-foreground">
          Advertiser <input value={filters.advertiser} onChange={(e) => setFilters((f) => ({ ...f, advertiser: e.target.value }))} className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          From <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          To <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" />
        </label>
        <button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50">
          {busy ? "Loading…" : "Apply / refresh"}
        </button>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {data?.flags.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-900">Needs attention ({data.flags.length})</p>
          <ul className="mt-1 space-y-1 text-[11.5px] text-amber-900">
            {data.flags.slice(0, 30).map((f, i) => (
              <li key={`${f.kind}-${f.reference}-${f.campaignId}-${i}`}>
                <strong>{f.kind.replace(/_/g, " ")}</strong> · {f.reference ?? "—"} {f.detail ? `· ${f.detail}` : ""} · {when(f.since)}
              </li>
            ))}
          </ul>
        </div>
      ) : data ? (
        <p className="text-xs text-emerald-700">No payment inconsistencies.</p>
      ) : null}

      {data ? (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[900px] text-left text-[11.5px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Created", "Advertiser · campaign", "Provider · ref", "USD", "Provider amount", "Rate", "Payment", "Campaign", "Verified", "Refund / dispute", ""].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.reference} className="border-t border-border/50 align-top">
                  <td className="px-2 py-1.5 whitespace-nowrap">{when(r.createdAt)}</td>
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{r.advertiser ?? "—"}</span>
                    <br />
                    {r.campaigns.map((c) => c.name).join(", ") || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.provider}
                    <br />
                    <span className="font-mono text-[10.5px] text-muted-foreground">{r.reference}</span>
                    {r.chargeId ? <span className="block font-mono text-[10.5px] text-muted-foreground">{r.chargeId}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{money(r.usdCents, "USD")}</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {money(r.providerAmount, r.providerCurrency)}
                    {r.paidAmount !== null ? <span className="block text-muted-foreground">paid {money(r.paidAmount, r.paidCurrency)}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{r.fxMinorPerUsd ? `₦${(r.fxMinorPerUsd / 100).toLocaleString("en-US")}/$` : "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", TONE[r.status] ?? "bg-slate-100 text-slate-700")}>{r.status}</span>
                    {r.statusReason ? <span className="mt-0.5 block text-muted-foreground">{r.statusReason}</span> : null}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.campaigns.map((c) => (
                      <span key={c.id} className="block">
                        {c.status}
                        {c.activatedAt ? ` · live ${when(c.activatedAt)}` : ""}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{when(r.verifiedAt)}</td>
                  <td className="px-2 py-1.5">
                    {r.refundedAt ? `refunded ${money(r.refundedAmount, r.paidCurrency ?? r.providerCurrency)} · ${when(r.refundedAt)}` : ""}
                    {r.disputedAt ? `disputed ${when(r.disputedAt)}` : ""}
                    {!r.refundedAt && !r.disputedAt ? "—" : ""}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {["pending", "verification_required"].includes(r.status) ? (
                      <button type="button" disabled={busy} onClick={() => void act(r.reference, "recheck")} className="rounded-lg border border-border px-2 py-0.5 font-semibold">
                        Check with provider
                      </button>
                    ) : null}
                    {r.status === "success" && r.campaigns.some((c) => c.status === "paid" || c.status === "validating") ? (
                      <button type="button" disabled={busy} onClick={() => void act(r.reference, "activate")} className="rounded-lg border border-border px-2 py-0.5 font-semibold">
                        Retry activation
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-2 py-4 text-center text-muted-foreground">
                    No ad payments match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{busy ? "Loading…" : "Opens when this tab is shown."}</p>
      )}
    </div>
  );
}
