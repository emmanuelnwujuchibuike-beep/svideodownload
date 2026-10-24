"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SubAdminReviews } from "@/features/admin/sub-admin-reviews";
import { usd } from "@/lib/creator/membership/engine";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

// Part 7: overview, search and Exclusive moderation — loaded only when this panel is open
// 0277: bundles and promotions per creator, with the audited pause — loaded only when this panel is open
const SubAdminPromotions = dynamic(() => import("./sub-admin-promotions").then((m) => m.SubAdminPromotions), { ssr: false });
const SubAdminInsights = dynamic(() => import("./sub-admin-insights").then((m) => m.SubAdminInsights), { ssr: false, loading: () => <div aria-hidden className="mt-6 h-40 animate-pulse rounded-2xl ex-skel motion-reduce:animate-none" /> });

/**
 * Admin → Rewards: SUB (0227, owner briefs 2026-10-11).
 *
 *   · The rules: buying and withdrawing on/off, both fees, the price bounds, the
 *     minimum withdrawal, the hold, the access period, instant Paystack payout,
 *     whether the reward qualification applies, and the viewer watermark. A
 *     change applies to the NEXT purchase or withdrawal; each row already made
 *     keeps the fee it was charged.
 *   · Every recent purchase with its price, fee and total, and a reversal that
 *     ends the access it bought and takes the price back off the creator's
 *     balance (as debt, if already withdrawn) — the same path a Paystack refund
 *     or dispute takes.
 *   · Creator balances and the financial audit log.
 * Loaded once when the panel opens; never polled.
 */

interface Purchase {
  id: string;
  creator_id: string;
  subscriber_id: string;
  price_cents: number;
  fee_cents: number;
  total_cents: number;
  charged_currency: string | null;
  charged_minor: number | null;
  reference: string;
  status: string;
  paid_at: string | null;
  reversed_at: string | null;
  created_at: string;
}
interface Balance {
  creator_id: string;
  pending_cents: number;
  available_cents: number;
  held_cents: number;
  debt_cents: number;
  lifetime_cents: number;
  withdrawn_cents: number;
}
interface Audit {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reference: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const input = "w-28 rounded-lg border border-black/[0.08] bg-white/70 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-white/10 dark:bg-white/[0.06]";

export function SubAdmin({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const c = settings.frenzRewards.sub;
  const [f, setF] = useState({
    purchasesEnabled: c.purchasesEnabled,
    withdrawalsEnabled: c.withdrawalsEnabled,
    autoPayout: c.autoPayout,
    requireQualification: c.requireQualification,
    watermark: c.watermark,
    purchaseFee: String(c.purchaseFeePercent),
    withdrawalFee: String(c.withdrawalFeePercent),
    minPrice: (c.minPriceCents / 100).toFixed(2),
    maxPrice: (c.maxPriceCents / 100).toFixed(2),
    minWithdrawal: (c.minWithdrawalCents / 100).toFixed(2),
    // the flat fee on every withdrawal, by tier (owner 2026-10-17) — private-post money and AI credits
    feeUnder: (c.flatFees.underCents / 100).toFixed(2),
    feeMid: (c.flatFees.midCents / 100).toFixed(2),
    feeOver: (c.flatFees.overCents / 100).toFixed(2),
    feeMidFrom: (c.flatFees.midFromCents / 100).toFixed(2),
    feeOverAbove: (c.flatFees.overAboveCents / 100).toFixed(2),
    holdDays: String(c.holdDays),
    periodDays: String(c.periodDays),
    payoutProvider: c.payoutProvider,
    autoMax: (c.autoPayoutMaxCents / 100).toFixed(2),
    autoDailyMax: (c.autoPayoutDailyMaxCents / 100).toFixed(2),
    newAccountHours: String(c.newAccountHoldHours),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [data, setData] = useState<{ purchases: Purchase[]; balances: Balance[]; audit: Audit[]; ready: boolean } | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Record<string, "refunded" | "disputed" | "reversed">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/memberships")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d ?? { purchases: [], balances: [], audit: [], ready: false }))
      .catch(() => !cancelled && setData({ purchases: [], balances: [], audit: [], ready: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const cents = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Math.max(1, Math.round(Number(v) * 100)) : d);
  const pct = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Math.min(50, Math.max(0, Number(v))) : d);
  // a fee may be $0 (cents() floors at 1 cent)
  const fee = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Math.max(0, Math.round(Number(v) * 100)) : d);
  const int = (v: string, d: number, lo: number, hi: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : d);

  const save = async () => {
    setSaving(true);
    setSaved(null);
    const sub = {
      purchasesEnabled: f.purchasesEnabled,
      withdrawalsEnabled: f.withdrawalsEnabled,
      autoPayout: f.autoPayout,
      requireQualification: f.requireQualification,
      watermark: f.watermark,
      purchaseFeePercent: pct(f.purchaseFee, c.purchaseFeePercent),
      withdrawalFeePercent: pct(f.withdrawalFee, c.withdrawalFeePercent),
      minPriceCents: cents(f.minPrice, c.minPriceCents),
      maxPriceCents: cents(f.maxPrice, c.maxPriceCents),
      minWithdrawalCents: cents(f.minWithdrawal, c.minWithdrawalCents),
      // always sent whole: the server normalizes `sub` as one object, so leaving these out would reset them
      flatFees: {
        underCents: fee(f.feeUnder, c.flatFees.underCents),
        midCents: fee(f.feeMid, c.flatFees.midCents),
        overCents: fee(f.feeOver, c.flatFees.overCents),
        midFromCents: cents(f.feeMidFrom, c.flatFees.midFromCents),
        overAboveCents: cents(f.feeOverAbove, c.flatFees.overAboveCents),
      },
      holdDays: int(f.holdDays, c.holdDays, 0, 90),
      periodDays: int(f.periodDays, c.periodDays, 1, 366),
      payoutProvider: f.payoutProvider,
      autoPayoutMaxCents: cents(f.autoMax, c.autoPayoutMaxCents),
      autoPayoutDailyMaxCents: cents(f.autoDailyMax, c.autoPayoutDailyMaxCents),
      newAccountHoldHours: int(f.newAccountHours, c.newAccountHoldHours, 0, 720),
    };
    try {
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzRewards: { sub } }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setSaved(res.ok ? { ok: true, text: "Saved. New purchases and withdrawals use these rules; past ones keep theirs." } : { ok: false, text: j.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setSaved({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  const reverse = async (p: Purchase) => {
    const why = (reason[p.id] ?? "").trim();
    if (why.length < 3) return setNote("Give a reason of at least 3 characters first.");
    setBusy(p.id);
    setNote(null);
    const status = kind[p.id] ?? "reversed";
    const res = await fetch("/api/admin/memberships", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: p.reference, status, note: why }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string; debtAfter?: number } | null;
    setBusy(null);
    if (!res?.ok) return setNote(j?.error ?? "Couldn't reverse it.");
    setData((d) => (d ? { ...d, purchases: d.purchases.map((x) => (x.id === p.id ? { ...x, status, reversed_at: new Date().toISOString() } : x)) } : d));
    setNote(`Reversed. The access it bought has ended${j?.debtAfter ? `; the creator now owes ${usd(j.debtAfter)}` : ""}. Refund the subscriber in Paystack if money is going back.`);
  };

  const paid = (data?.purchases ?? []).filter((p) => p.status === "paid");
  const totals = paid.reduce((a, p) => ({ price: a.price + p.price_cents, fee: a.fee + p.fee_cents }), { price: 0, fee: 0 });
  const Switch = ({ k, label }: { k: "purchasesEnabled" | "withdrawalsEnabled" | "autoPayout" | "requireQualification" | "watermark"; label: string }) => (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <section className="ex-card px-3 py-6 sm:px-6">
      <h2 className="font-semibold">Private posts — paid subscriptions</h2>
      <SubAdminReviews />
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Real money through Flutterwave or Paystack, separate from AI credits. The subscriber pays the creator&apos;s price plus the purchase fee; a private post withdrawal pays out less the withdrawal fee.</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Switch k="purchasesEnabled" label="New subscriptions can be bought" />
        <Switch k="withdrawalsEnabled" label="Private post withdrawals are open" />
        <Switch k="autoPayout" label="Pay withdrawals at once through Flutterwave or Paystack (no admin step — within the safety limits below)" />
        <Switch k="requireQualification" label="Require the reward qualification to withdraw private post earnings" />
        <Switch k="watermark" label="Watermark subscriber-only media with the viewer's @handle" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted-foreground">Purchase fee (%)<input inputMode="decimal" value={f.purchaseFee} onChange={(e) => setF({ ...f, purchaseFee: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Withdrawal fee (%)<input inputMode="decimal" value={f.withdrawalFee} onChange={(e) => setF({ ...f, withdrawalFee: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Lowest price ($)<input inputMode="decimal" value={f.minPrice} onChange={(e) => setF({ ...f, minPrice: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Highest price ($)<input inputMode="decimal" value={f.maxPrice} onChange={(e) => setF({ ...f, maxPrice: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Minimum withdrawal ($)<input inputMode="decimal" value={f.minWithdrawal} onChange={(e) => setF({ ...f, minWithdrawal: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Flat withdrawal fee, below the first limit ($)<input inputMode="decimal" value={f.feeUnder} onChange={(e) => setF({ ...f, feeUnder: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">First limit ($)<input inputMode="decimal" value={f.feeMidFrom} onChange={(e) => setF({ ...f, feeMidFrom: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Flat fee from the first limit ($)<input inputMode="decimal" value={f.feeMid} onChange={(e) => setF({ ...f, feeMid: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Second limit ($)<input inputMode="decimal" value={f.feeOverAbove} onChange={(e) => setF({ ...f, feeOverAbove: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Flat fee above the second limit ($)<input inputMode="decimal" value={f.feeOver} onChange={(e) => setF({ ...f, feeOver: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Hold before withdrawable (days)<input inputMode="numeric" value={f.holdDays} onChange={(e) => setF({ ...f, holdDays: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Access per payment (days)<input inputMode="numeric" value={f.periodDays} onChange={(e) => setF({ ...f, periodDays: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Payout provider (Nigerian banks)
          <select value={f.payoutProvider} onChange={(e) => setF({ ...f, payoutProvider: e.target.value === "paystack" ? "paystack" : "flutterwave" })} className={cn(input, "mt-1 block w-full")}>
            <option value="flutterwave">Flutterwave (Paystack as backup)</option>
            <option value="paystack">Paystack</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Instant payout: most per withdrawal ($)<input inputMode="decimal" value={f.autoMax} onChange={(e) => setF({ ...f, autoMax: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">Instant payout: most per creator per 24 h ($)<input inputMode="decimal" value={f.autoDailyMax} onChange={(e) => setF({ ...f, autoDailyMax: e.target.value })} className={cn(input, "mt-1 block")} /></label>
        <label className="text-xs text-muted-foreground">New bank account: wait before instant payout (hours)<input inputMode="numeric" value={f.newAccountHours} onChange={(e) => setF({ ...f, newAccountHours: e.target.value })} className={cn(input, "mt-1 block")} /></label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The flat fee applies to EVERY withdrawal (private-post money and AI credits), on top of the amount: the balance must cover both. Below the first limit the first fee; from the first limit up to and including the second, the middle fee; above the second, the last fee.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving} className={cn("btn-lux bg-foreground text-background", saving && "opacity-60")}>
          {saving ? "Saving…" : "Save private post rules"}
        </button>
        {saved ? <p className={cn("text-sm", saved.ok ? "text-emerald-600" : "text-rose-600 dark:text-rose-400")}>{saved.text}</p> : null}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Purchases (last 100)</h3>
      {!data ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : !data.ready ? (
        <p className="mt-2 text-sm text-muted-foreground">Arrives with migration 0227.</p>
      ) : data.purchases.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No private post purchases yet.</p>
      ) : (
        <>
          <p className="mt-2 text-sm">
            Paid, shown here: <b className="tabular-nums">{usd(totals.price)}</b> to creators · <b className="tabular-nums">{usd(totals.fee)}</b> in purchase fees
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">When</th>
                  <th className="py-1.5 pr-2 font-medium">Price + fee = total</th>
                  <th className="py-1.5 pr-2 font-medium">Charged</th>
                  <th className="py-1.5 pr-2 font-medium">Reference</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.purchases.map((p) => (
                  <tr key={p.id} className="border-t border-black/[0.06] dark:border-white/[0.07] align-top">
                    <td className="py-2 pr-2 tabular-nums">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-2 tabular-nums">
                      {usd(p.price_cents)} + {usd(p.fee_cents)} = {usd(p.total_cents)}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">{p.charged_minor != null && p.charged_currency ? `${(p.charged_minor / 100).toLocaleString()} ${p.charged_currency}` : "—"}</td>
                    <td className="py-2 pr-2 font-mono text-[11px]">{p.reference}</td>
                    <td className="py-2">
                      {p.status !== "paid" ? (
                        <span className="capitalize text-muted-foreground">{p.status}</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <select aria-label="Kind" value={kind[p.id] ?? "reversed"} onChange={(e) => setKind({ ...kind, [p.id]: e.target.value as "refunded" | "disputed" | "reversed" })} className="rounded-lg border border-black/[0.08] bg-white/70 dark:border-white/10 dark:bg-white/[0.06] px-1.5 py-1">
                            <option value="reversed">Reversal</option>
                            <option value="refunded">Refund</option>
                            <option value="disputed">Dispute</option>
                          </select>
                          <input aria-label="Reason" placeholder="Reason" value={reason[p.id] ?? ""} onChange={(e) => setReason({ ...reason, [p.id]: e.target.value })} className="w-32 rounded-lg border border-black/[0.08] bg-white/70 dark:border-white/10 dark:bg-white/[0.06] px-2 py-1" />
                          <button type="button" disabled={busy === p.id} onClick={() => void reverse(p)} className="rounded-lg border border-rose-500/50 px-2 py-1 font-semibold text-rose-600 dark:text-rose-400 transition active:scale-95 disabled:opacity-50">
                            {busy === p.id ? "Reversing…" : "Reverse"}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}

      {data?.balances.length ? (
        <>
          <h3 className="mt-6 text-sm font-semibold">Creator balances</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Creator</th>
                  <th className="py-1.5 pr-2 font-medium">Clearing</th>
                  <th className="py-1.5 pr-2 font-medium">Available</th>
                  <th className="py-1.5 pr-2 font-medium">Being paid</th>
                  <th className="py-1.5 pr-2 font-medium">Debt</th>
                  <th className="py-1.5 pr-2 font-medium">Lifetime</th>
                  <th className="py-1.5 font-medium">Withdrawn</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.creator_id} className="border-t border-black/[0.06] dark:border-white/[0.07] tabular-nums">
                    <td className="py-2 pr-2 font-mono text-[11px]">{b.creator_id.slice(0, 8)}</td>
                    <td className="py-2 pr-2">{usd(b.pending_cents)}</td>
                    <td className="py-2 pr-2">{usd(b.available_cents)}</td>
                    <td className="py-2 pr-2">{usd(b.held_cents)}</td>
                    <td className={cn("py-2 pr-2", b.debt_cents > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{usd(b.debt_cents)}</td>
                    <td className="py-2 pr-2">{usd(b.lifetime_cents)}</td>
                    <td className="py-2">{usd(b.withdrawn_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {data?.audit.length ? (
        <>
          <h3 className="mt-6 text-sm font-semibold">Financial audit log (last 100)</h3>
          <ul className="mt-2 max-h-80 ex-card ex-rows overflow-y-auto text-xs">
            {data.audit.map((a) => (
              <li key={a.id} className="px-3 py-2">
                <span className="font-semibold">{a.action}</span> <span className="text-muted-foreground">· {new Date(a.created_at).toLocaleString()}</span>
                {a.reference ? <span className="ml-1 font-mono text-[11px]">{a.reference}</span> : null}
                <span className="block text-muted-foreground">
                  {a.actor_id ? `by ${a.actor_id.slice(0, 8)}` : "by the system"}
                  {a.details ? ` · ${Object.entries(a.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <SubAdminInsights />
      <SubAdminPromotions />
    </section>
  );
}
