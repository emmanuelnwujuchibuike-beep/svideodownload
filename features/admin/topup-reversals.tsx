"use client";

import { useCallback, useEffect, useState } from "react";

import { useSensitiveAction } from "@/features/admin/use-sensitive-action";
import { formatCredits } from "@/lib/ai/credits/units";
import { cn } from "@/lib/utils";

/**
 * Admin → Rewards → Top-up refunds & chargebacks (Frenz Coin Part 2, H1 — 0278).
 *
 * A paid deposit is withdrawable credit, so a refunded or charged-back top-up takes its credits back. Paystack's signed
 * refund and dispute events do it on their own; Flutterwave has no event contract here, so an admin records what the
 * Flutterwave dashboard shows. A dispute HOLDS the credits until its outcome is recorded below. A shortfall (credits
 * already spent or sent) restricts the account until it is settled. Every write asks for a fresh password and is audited.
 */
type Row = { id: string; provider: string; kind: string; reference: string; userId: string; state: string; due: number; recovered: number; shortfall: number; shortfallCleared: boolean; createdAt: string };

const newKey = () => `tr_${crypto.randomUUID().replace(/-/g, "")}`;

export function TopupReversals() {
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ready, setReady] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ reference: "", kind: "refund" as "refund" | "dispute", refundedMinor: "", note: "" });
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/wallet/topup-reversals", { cache: "no-store" }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { rows?: Row[]; ready?: boolean } | null;
    setRows(json?.rows ?? []);
    setReady(json?.ready !== false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const record = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const refunded = form.refundedMinor.trim() ? Number(form.refundedMinor) : undefined;
    const res = await sensitiveFetch("/api/admin/wallet/topup-reversals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: form.reference.trim(), kind: form.kind, ...(refunded ? { refundedMinor: refunded } : {}), idempotencyKey: key, note: form.note.trim() }) }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { error?: string; recovered?: number; shortfall?: number; duplicate?: boolean };
    setBusy(false);
    if (!res?.ok) return setMsg({ ok: false, text: json.error ?? "Couldn't record it." });
    setMsg({ ok: true, text: json.duplicate ? "Already recorded." : `Recorded: ${formatCredits(json.recovered ?? 0)} taken back${json.shortfall ? `, ${formatCredits(json.shortfall)} short (account restricted)` : ""}.` });
    setForm({ reference: "", kind: "refund", refundedMinor: "", note: "" });
    setKey(newKey());
    void load();
  };

  const update = async (id: string, body: Record<string, unknown>) => {
    const note = window.prompt("Reason (kept in the audit log):")?.trim();
    if (!note) return;
    const res = await sensitiveFetch(`/api/admin/wallet/topup-reversals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, note }) }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { error?: string };
    setMsg(res?.ok ? { ok: true, text: "Saved." } : { ok: false, text: json.error ?? "Couldn't update it." });
    void load();
  };

  const field = "mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm";
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      {reauthPrompt}
      <h2 className="font-semibold">Top-up refunds &amp; chargebacks</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        A refunded or disputed top-up takes its credits back, never below zero. Paystack events apply on their own. For Flutterwave, record what its dashboard shows. A dispute holds the credits until you record the outcome.
      </p>
      {!ready ? <p className="mt-3 text-sm text-muted-foreground">Arrives with migration 0278.</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Top-up reference
          <input className={field} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="frenz_cr_topup_…" />
        </label>
        <label className="text-xs text-muted-foreground">
          What happened
          <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "refund" | "dispute" })}>
            <option value="refund">Refunded</option>
            <option value="dispute">Chargeback / dispute opened</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Amount refunded, in the charge&apos;s minor units (blank = all of it)
          <input className={field} inputMode="numeric" value={form.refundedMinor} onChange={(e) => setForm({ ...form, refundedMinor: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="text-xs text-muted-foreground">
          Reason
          <input className={field} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
      </div>
      <button type="button" onClick={record} disabled={busy || form.reference.trim().length < 10 || form.note.trim().length < 3} className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {busy ? "Recording…" : "Record"}
      </button>
      {msg ? <p className={cn("mt-2 text-sm", msg.ok ? "text-emerald-700" : "text-rose-500")}>{msg.text}</p> : null}
      <ul className="mt-5 divide-y divide-border text-sm">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium">{r.kind === "dispute" ? "Dispute" : "Refund"}</span> · {r.provider} · <span className="break-all text-muted-foreground">{r.reference}</span>
              <span className="block text-xs text-muted-foreground">
                {r.state} · {formatCredits(r.recovered)} of {formatCredits(r.due)} taken back{r.shortfall ? ` · ${formatCredits(r.shortfall)} short${r.shortfallCleared ? " (settled)" : ""}` : ""} · {new Date(r.createdAt).toLocaleString()}
              </span>
            </span>
            <span className="flex gap-2">
              {r.kind === "dispute" && r.state === "held" ? (
                <>
                  <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs" onClick={() => update(r.id, { action: "resolve", outcome: "won" })}>Won</button>
                  <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs" onClick={() => update(r.id, { action: "resolve", outcome: "lost" })}>Lost</button>
                </>
              ) : null}
              {r.shortfall > 0 && !r.shortfallCleared ? (
                <button type="button" className="rounded-lg border border-border px-2 py-1 text-xs" onClick={() => update(r.id, { action: "clear" })}>Settled</button>
              ) : null}
            </span>
          </li>
        ))}
        {rows && rows.length === 0 && ready ? <li className="py-2 text-muted-foreground">None.</li> : null}
      </ul>
    </section>
  );
}
