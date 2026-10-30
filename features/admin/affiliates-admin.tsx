"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

type Row = { userId: string; handle: string | null; displayName: string | null; status: string; rateBp: number; reviewedAt: string | null; note: string | null; earnedCredits: number };

const input = "h-10 rounded-xl border border-border bg-background px-3 text-sm";

/**
 * Admin → Rewards → Affiliates (owner, 2026-10-30): members ask support to join; the admin approves them here at a rate
 * (the default is the Affiliate rate in the rules above), changes it, or revokes. Only an approved affiliate can cash out
 * AI credits, and they earn their rate on their invitees' DEPOSITS SPENT ON AI (0309) and AI plans.
 */
export function AffiliatesAdmin({ defaultRatePercent }: { defaultRatePercent: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [handle, setHandle] = useState("");
  const [rate, setRate] = useState(String(defaultRatePercent));
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/rewards/affiliates", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { affiliates?: Row[] }) => setRows(j.affiliates ?? []))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const save = async (body: { handle?: string; userId?: string; status: "approved" | "revoked"; ratePercent: number }, key: string) => {
    setBusy(key);
    const res = await fetch("/api/admin/rewards/affiliates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!res?.ok) return toast(j?.error ?? "Couldn't save that.", "error");
    toast(body.status === "approved" ? "Affiliate approved." : "Affiliate revoked.", "success");
    if (key === "add") setHandle("");
    load();
  };

  const ratePercent = Number(rate);
  const rateOk = Number.isFinite(ratePercent) && ratePercent >= 0 && ratePercent <= 50;

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="text-base font-bold">Affiliates</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Only approved affiliates can cash out AI credits. They earn their rate on what the members they invite spend on AI from deposits, and on AI plans — never on a deposit that is not spent. Everyone else uses their credits for Frenz AI.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Member
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" className={cn(input, "mt-1 block w-44")} />
        </label>
        <label className="text-xs text-muted-foreground">
          Rate %
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={cn(input, "mt-1 block w-20")} />
        </label>
        <button
          type="button"
          disabled={!handle.trim() || !rateOk || !!busy}
          onClick={() => void save({ handle: handle.trim(), status: "approved", ratePercent }, "add")}
          className="h-10 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
        >
          {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
        </button>
      </div>

      {rows === null ? (
        <Loader2 className="mt-4 h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading affiliates" />
      ) : !rows.length ? (
        <p className="mt-4 text-sm text-muted-foreground">No affiliates yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
          {rows.map((r) => (
            <AffiliateRow key={r.userId} row={r} busy={busy === r.userId} onSave={(status, pct) => void save({ userId: r.userId, status, ratePercent: pct }, r.userId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AffiliateRow({ row, busy, onSave }: { row: Row; busy: boolean; onSave: (status: "approved" | "revoked", ratePercent: number) => void }) {
  const [rate, setRate] = useState(String(row.rateBp / 100));
  const pct = Number(rate);
  const ok = Number.isFinite(pct) && pct >= 0 && pct <= 50;
  const approved = row.status === "approved";
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{row.handle ? `@${row.handle}` : row.userId.slice(0, 8)}</span>
        <span className="block text-xs text-muted-foreground">
          <span className={approved ? "text-emerald-600" : "text-muted-foreground"}>{row.status}</span> · {row.earnedCredits.toLocaleString("en-US")} credits earned
        </span>
      </span>
      <input aria-label="Rate %" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={cn(input, "w-16")} />
      <span className="text-xs text-muted-foreground">%</span>
      <button type="button" disabled={!ok || busy} onClick={() => onSave("approved", pct)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50">
        {approved ? "Save rate" : "Approve"}
      </button>
      {approved ? (
        <button type="button" disabled={busy} onClick={() => onSave("revoked", pct)} className="h-9 rounded-xl border border-rose-300 px-3 text-xs font-semibold text-rose-600 disabled:opacity-50">
          Revoke
        </button>
      ) : null}
    </li>
  );
}
