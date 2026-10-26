"use client";

import { useMemo, useState } from "react";

import { type ReversalRow, reversalView } from "./coin-admin-logic";
import { postMoney, useAdminRead, useReplayKey } from "./coin-admin-data";
import { BTN, Badge, Card, Empty, Field, INPUT, Message, usd, when } from "./coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Recorded = { ok: true; id: string; state: string; due?: number; recovered?: number; shortfall?: number; duplicate?: boolean };

/**
 * Admin → Frenz Coin → Deposit reversals (Part 6). The existing workflow (0280 / 0283), nothing new:
 *   GET  /api/admin/wallet/coin-deposit-reversals          the list
 *   POST /api/admin/wallet/coin-deposit-reversals          record a refund or chargeback seen in the Flutterwave dashboard
 *                                                          (the charge is re-verified first; a replay key per record)
 *   POST /api/admin/wallet/coin-deposit-reversals/[id]     a dispute's outcome (won / lost), apply a partial refund held
 *                                                          for review, or settle a shortfall
 * Every one asks for a fresh password and is audited. The states are the API's own: taken back, chargeback awaiting an
 * outcome, won, lost, partial refund pending review, applied — and an open or settled shortfall. There is no "rejected"
 * state: a partial refund in review can only be applied.
 */
export function CoinReversals({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const list = useAdminRead<{ rows: ReversalRow[] }>("/api/admin/wallet/coin-deposit-reversals");
  const [filter, setFilter] = useState<"action" | "all">("action");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; kind: "ok" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState<{ id: string; action: "resolve" | "apply_partial" | "clear"; outcome: "won" | "lost"; note: string } | null>(null);
  const [rec, setRec] = useState({ reference: "", kind: "refund" as "refund" | "dispute", partial: false, refundedMinor: "", note: "" });
  const keyFor = useReplayKey();

  const rows = useMemo(() => {
    const all = list.data?.rows ?? [];
    return filter === "all" ? all : all.filter((r) => reversalView(r).needsAction);
  }, [list.data, filter]);

  const record = async () => {
    if (busy) return;
    const reference = rec.reference.trim();
    const refundedMinor = rec.partial ? Number(rec.refundedMinor) : undefined;
    if (!reference || rec.note.trim().length < 3 || (rec.partial && !(Number.isSafeInteger(refundedMinor) && (refundedMinor ?? 0) > 0))) return setMsg({ id: "record", kind: "error", text: "Give the deposit reference, a reason, and — for a partial refund — the refunded amount in the charge's minor units." });
    if (!window.confirm(`Record a ${rec.kind === "dispute" ? "chargeback" : rec.partial ? "partial refund" : "full refund"} for ${reference}? Coins are taken back now where available (a partial refund waits for review).`)) return;
    setBusy("record");
    setMsg(null);
    const idempotencyKey = keyFor(`${reference}:${rec.kind}:${refundedMinor ?? "all"}`);
    const r = await postMoney<Recorded>(sensitiveFetch, "/api/admin/wallet/coin-deposit-reversals", { reference, kind: rec.kind, idempotencyKey, note: rec.note.trim(), ...(refundedMinor ? { refundedMinor } : {}) });
    setBusy(null);
    if (!r.ok) return setMsg({ id: "record", kind: "error", text: r.error });
    const d = r.data;
    setMsg({ id: "record", kind: "ok", text: d.duplicate ? "Already recorded — this is the same reversal. Nothing was taken twice." : `Recorded (${d.state}). Due ${usd(d.due ?? 0)}, recovered ${usd(d.recovered ?? 0)}${d.shortfall ? `, shortfall ${usd(d.shortfall)} to settle` : ""}.` });
    setRec({ reference: "", kind: "refund", partial: false, refundedMinor: "", note: "" });
    void list.reload();
  };

  const update = async () => {
    if (!acting || busy) return;
    if (acting.note.trim().length < 3) return setMsg({ id: acting.id, kind: "error", text: "Give a reason — it is kept in the audit log." });
    setBusy(acting.id);
    setMsg(null);
    const body = acting.action === "resolve" ? { action: "resolve", outcome: acting.outcome, note: acting.note.trim() } : { action: acting.action, note: acting.note.trim() };
    const r = await postMoney<{ ok: true }>(sensitiveFetch, `/api/admin/wallet/coin-deposit-reversals/${acting.id}`, body);
    setBusy(null);
    if (!r.ok) return setMsg({ id: acting.id, kind: "error", text: r.error });
    setMsg({ id: acting.id, kind: "ok", text: acting.action === "resolve" ? (acting.outcome === "won" ? "Dispute won — the coins were restored." : "Dispute lost — recorded.") : acting.action === "apply_partial" ? "Partial refund applied." : "Shortfall settled." });
    setActing(null);
    void list.reload();
  };

  return (
    <div className="space-y-5">
      <Card title="Record a refund or chargeback">
        <p className="mb-3 text-xs text-muted-foreground">Only after you see it in the Flutterwave dashboard. The original charge is checked again first. A full refund or a chargeback takes the coins back now (any part already spent becomes a shortfall); a partial refund is held for review and applied separately.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="rev-ref" label="Deposit reference">
            <input id="rev-ref" className={`${INPUT} font-mono`} placeholder="frenz_coin_dep_fw_…" value={rec.reference} onChange={(e) => setRec({ ...rec, reference: e.target.value })} />
          </Field>
          <Field htmlFor="rev-kind" label="What happened">
            <select id="rev-kind" className={INPUT} value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as "refund" | "dispute", partial: e.target.value === "dispute" ? false : rec.partial })}>
              <option value="refund">Refund</option>
              <option value="dispute">Chargeback (dispute)</option>
            </select>
          </Field>
          {rec.kind === "refund" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rec.partial} onChange={(e) => setRec({ ...rec, partial: e.target.checked })} />
              Only part of the charge was refunded
            </label>
          ) : null}
          {rec.partial ? (
            <Field htmlFor="rev-minor" label="Refunded amount (minor units of the charge, e.g. cents)">
              <input id="rev-minor" inputMode="numeric" className={INPUT} value={rec.refundedMinor} onChange={(e) => setRec({ ...rec, refundedMinor: e.target.value.replace(/\D/g, "") })} />
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Field htmlFor="rev-note" label="Reason (kept in the audit log)">
              <input id="rev-note" className={INPUT} maxLength={500} value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} />
            </Field>
          </div>
        </div>
        <button type="button" className={`${BTN} mt-4 bg-foreground text-background`} disabled={busy === "record"} aria-busy={busy === "record"} onClick={() => void record()}>
          {busy === "record" ? "Recording…" : "Record"}
        </button>
        {msg?.id === "record" ? <div className="mt-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
      </Card>

      <Card
        title="Reversals"
        action={
          <div className="flex gap-2">
            <div role="radiogroup" aria-label="Filter" className="flex rounded-xl border border-border p-0.5">
              {(["action", "all"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${filter === f ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  {f === "action" ? "Needs action" : "All"}
                </button>
              ))}
            </div>
            <button type="button" className={`${BTN} border border-border`} onClick={() => void list.reload()} disabled={list.loading || list.refreshing}>{list.refreshing ? "Refreshing…" : "Refresh"}</button>
          </div>
        }
      >
        {list.loading ? (
          <p className="text-sm text-muted-foreground">Loading reversals…</p>
        ) : list.error && !list.data ? (
          <Message kind="error">{list.error}</Message>
        ) : rows.length === 0 ? (
          <Empty>{filter === "action" ? "Nothing waiting for a decision." : "No deposit reversals recorded."}</Empty>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const v = reversalView(r);
              return (
                <li key={r.id} className="rounded-2xl border border-border p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs">{r.reference}</p>
                      <p className="text-xs text-muted-foreground">{when(r.createdAt)} · {r.kind === "dispute" ? "Chargeback" : "Refund"} · deposit {r.phase === "held" ? "still on hold" : "already released"}</p>
                    </div>
                    <Badge tone={v.tone}>{v.label}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Deposit</dt><dd className="font-semibold">{usd(r.depositCents)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Due back</dt><dd className="font-semibold">{usd(r.due)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Recovered</dt><dd className="font-semibold">{usd(r.recovered)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Shortfall</dt><dd className="font-semibold">{r.shortfall ? `${usd(r.shortfall)}${r.shortfallCleared ? " (settled)" : ""}` : "—"}</dd></div>
                  </dl>
                  {v.actions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {v.actions.includes("resolve") ? (
                        <>
                          <button type="button" className={`${BTN} border border-emerald-500/50 text-emerald-700 dark:text-emerald-300`} disabled={!!busy} onClick={() => setActing({ id: r.id, action: "resolve", outcome: "won", note: "" })}>Dispute won…</button>
                          <button type="button" className={`${BTN} border border-rose-500/50 text-rose-700 dark:text-rose-300`} disabled={!!busy} onClick={() => setActing({ id: r.id, action: "resolve", outcome: "lost", note: "" })}>Dispute lost…</button>
                        </>
                      ) : null}
                      {v.actions.includes("apply_partial") ? <button type="button" className={`${BTN} border border-border`} disabled={!!busy} onClick={() => setActing({ id: r.id, action: "apply_partial", outcome: "won", note: "" })}>Apply partial refund…</button> : null}
                      {v.actions.includes("clear") ? <button type="button" className={`${BTN} border border-border`} disabled={!!busy} onClick={() => setActing({ id: r.id, action: "clear", outcome: "won", note: "" })}>Settle shortfall…</button> : null}
                    </div>
                  ) : null}
                  {acting?.id === r.id ? (
                    <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3">
                      <p className="text-sm font-semibold">{acting.action === "resolve" ? `Record: dispute ${acting.outcome}` : acting.action === "apply_partial" ? "Apply the partial refund (its share only, once)" : "Settle the shortfall (recovered or written off)"}</p>
                      <label htmlFor={`act-${r.id}`} className="text-xs font-semibold">Reason (kept in the audit log)</label>
                      <input id={`act-${r.id}`} className={INPUT} maxLength={500} value={acting.note} onChange={(e) => setActing({ ...acting, note: e.target.value })} />
                      <div className="flex gap-2">
                        <button type="button" className={`${BTN} bg-foreground text-background`} disabled={!!busy || acting.note.trim().length < 3} aria-busy={busy === r.id} onClick={() => void update()}>{busy === r.id ? "Recording…" : "Confirm"}</button>
                        <button type="button" className={`${BTN} border border-border`} onClick={() => setActing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                  {msg?.id === r.id ? <div className="mt-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
