"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { PAID_VERIFICATION_MAX_DAYS, PAID_VERIFICATION_PRICE, type PaidVerificationConfig } from "@/lib/social/paid-verification-config";

/**
 * The admin's paid-verification settings (0268, owner 2026-10-22: "the price can be set by admin"): the
 * switch, the price in US dollars (members pay it in the checkout currency at the live rate) and how long
 * a paid tick lasts (0 = for good). The server clamps whatever is sent (paid-verification-config.ts).
 */
export function PaidVerificationSettings({ initial }: { initial: PaidVerificationConfig }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [price, setPrice] = useState(initial.priceCents ? (initial.priceCents / 100).toFixed(2) : "");
  const [days, setDays] = useState(String(initial.periodDays));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setNote(null);
    const priceCents = Math.round(Number(price) * 100);
    const periodDays = Math.round(Number(days));
    try {
      const res = await fetch("/api/admin/verification/paid-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, priceCents, periodDays }) });
      const json = (await res.json().catch(() => null)) as { config?: PaidVerificationConfig; error?: string } | null;
      if (!res.ok || !json?.config) {
        setNote({ ok: false, text: json?.error ?? "Couldn't save." });
        return;
      }
      const c = json.config;
      setEnabled(c.enabled);
      setPrice(c.priceCents ? (c.priceCents / 100).toFixed(2) : "");
      setDays(String(c.periodDays));
      setNote(
        enabled && !c.enabled
          ? { ok: false, text: `Saved, but switched OFF: the price must be between $${PAID_VERIFICATION_PRICE.minCents / 100} and $${PAID_VERIFICATION_PRICE.maxCents / 100}.` }
          : { ok: true, text: c.enabled ? `On — $${(c.priceCents / 100).toFixed(2)} ${c.periodDays ? `for ${c.periodDays} days` : "for good"}.` : "Saved — paid verification is off." },
      );
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-5 w-5" />
        <span>
          <span className="block text-sm font-semibold">Paid verification on (members can buy the blue tick)</span>
          <span className="block text-xs text-muted-foreground">
            A second way to the tick beside the reviewed application. Granted only when Paystack confirms the payment; a refund takes it back.
          </span>
        </span>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
        <label className="text-xs font-semibold">
          Price (US $)
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5.00" className="mt-1 h-10 w-full rounded-full border border-border/70 bg-background px-3 text-sm font-normal" />
        </label>
        <label className="text-xs font-semibold">
          Lasts (days, 0 = for good)
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" className="mt-1 h-10 w-full rounded-full border border-border/70 bg-background px-3 text-sm font-normal" />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        ${PAID_VERIFICATION_PRICE.minCents / 100}–${PAID_VERIFICATION_PRICE.maxCents / 100}; up to {PAID_VERIFICATION_MAX_DAYS} days. Members pay it in the checkout currency at the live rate, like subscriptions. When a paid period ends without a renewal the tick is taken back — a reviewed or admin-issued tick never is.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </button>
        {note ? <span className={note.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>{note.text}</span> : null}
      </div>
    </div>
  );
}
