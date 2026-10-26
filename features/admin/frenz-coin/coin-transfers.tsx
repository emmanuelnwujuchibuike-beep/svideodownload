"use client";

import { useState } from "react";

import type { AdminCoinTransfer } from "@/lib/coin/admin-transfers";

import { centsToDollars, correctionProblem, dollarsToCents } from "./coin-admin-logic";
import { postMoney, useAdminRead, useReplayKey } from "./coin-admin-data";
import { BTN, Badge, Card, Empty, Field, INPUT, Message, usd, when } from "./coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
const who = (p: { handle: string | null; name: string | null; id: string }) => p.name || (p.handle ? `@${p.handle}` : p.id.slice(0, 8));

/** One transfer: the record, its correction history, and the correction form. */
function TransferDetail({ id, sensitiveFetch, onBack }: { id: string; sensitiveFetch: SensitiveFetch; onBack: () => void }) {
  const one = useAdminRead<{ items: AdminCoinTransfer[] }>(`/api/admin/wallet/coin-transfers?id=${encodeURIComponent(id)}`);
  const [kind, setKind] = useState<"fee_refund" | "sender_credit">("fee_refund");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const keyFor = useReplayKey();
  const t = one.data?.items[0];

  if (one.loading) return <p className="text-sm text-muted-foreground">Loading the transfer…</p>;
  if (!t) return <Message kind="error">{one.error ?? "No transfer has that id."}</Message>;

  const problem = correctionProblem(t, kind, amount, reason);
  const cents = kind === "fee_refund" ? t.feeCents : (dollarsToCents(amount) ?? 0);

  const submit = async () => {
    if (problem || !confirm || busy) return;
    setBusy(true);
    setResult(null);
    // the same key while the operator retries this same correction; anything different gets a new one
    const idempotencyKey = keyFor(`${t.id}:${kind}:${cents}:${reason.trim()}`);
    const r = await postMoney<{ ok: true; id: string; amountCents: number; duplicate: boolean }>(sensitiveFetch, `/api/admin/wallet/coin-transfers/${t.id}/correct`, kind === "fee_refund" ? { kind, reason: reason.trim(), idempotencyKey } : { kind, amountCents: cents, reason: reason.trim(), idempotencyKey });
    setBusy(false);
    if (!r.ok) return setResult({ kind: "error", text: r.error });
    setResult({ kind: "ok", text: r.data.duplicate ? `Already recorded — this is the same correction (${r.data.id.slice(0, 8)}). Nothing was paid twice.` : `Recorded: ${usd(r.data.amountCents)} credited to ${who(t.sender)} from the platform. Correction ${r.data.id.slice(0, 8)} is in the audit log.` });
    setConfirm(false);
    setReason("");
    setAmount("");
    void one.reload();
  };

  return (
    <div className="space-y-5">
      <button type="button" className={`${BTN} border border-border`} onClick={onBack}>← All transfers</button>
      <Card title="Transfer" action={one.refreshing ? <span className="text-xs text-muted-foreground">Refreshing…</span> : null}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">From</dt><dd className="font-semibold">{who(t.sender)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">To</dt><dd className="font-semibold">{who(t.recipient)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">When</dt><dd>{when(t.createdAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="font-semibold">{usd(t.amountCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Fee</dt><dd className="font-semibold">{usd(t.feeCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Total debited</dt><dd className="font-semibold">{usd(t.totalCents)}</dd></div>
          <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted-foreground">Transfer id</dt><dd className="break-all font-mono text-xs">{t.id}</dd></div>
        </dl>
      </Card>

      <Card title={`Corrections (${t.corrections.length})`}>
        {t.corrections.length === 0 ? (
          <Empty>No corrections yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {t.corrections.map((c) => (
              <li key={c.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{c.kind === "fee_refund" ? "Fee refund" : "Sender credit"} · {usd(c.amountCents)}</span>
                  <span className="text-xs text-muted-foreground">{when(c.createdAt)} · by {who(c.admin)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{c.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Correct this transfer">
        <p className="mb-3 text-xs text-muted-foreground">For a confirmed error or fraud only. The sender is credited by the platform; the recipient is never debited. Both kinds are recorded in the ledger and the audit log, and ask for your password.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Correction</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="corr-kind" checked={kind === "fee_refund"} onChange={() => { setKind("fee_refund"); setConfirm(false); }} disabled={!t.feeRefundable} />
              <span>Refund the fee ({usd(t.feeCents)}) {t.feeRefundable ? null : <Badge tone="gray">{t.feeCents > 0 ? "already refunded" : "no fee"}</Badge>}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="corr-kind" checked={kind === "sender_credit"} onChange={() => { setKind("sender_credit"); setConfirm(false); }} disabled={t.creditRemainingCents <= 0} />
              <span>Credit the sender (up to {usd(t.creditRemainingCents)} left)</span>
            </label>
          </fieldset>
          {kind === "sender_credit" ? (
            <Field htmlFor="corr-amount" label="Amount to credit ($)" hint={`At most $${centsToDollars(t.creditRemainingCents)}`}>
              <input id="corr-amount" inputMode="decimal" className={INPUT} value={amount} onChange={(e) => { setAmount(e.target.value); setConfirm(false); }} />
            </Field>
          ) : null}
        </div>
        <div className="mt-4">
          <Field htmlFor="corr-reason" label="Reason (kept in the audit log)" hint="What happened and how it was confirmed — a few words at least.">
            <textarea id="corr-reason" rows={3} maxLength={500} className={`${INPUT} h-auto py-2`} value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(false); }} />
          </Field>
        </div>
        {!problem ? (
          <label className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>
              I confirm crediting <strong>{usd(cents)}</strong> to <strong>{who(t.sender)}</strong> from the platform ({kind === "fee_refund" ? "fee refund" : "sender credit"}). This can&apos;t be undone from here.
            </span>
          </label>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{problem}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={`${BTN} bg-foreground text-background`} disabled={!!problem || !confirm || busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? "Recording…" : "Record correction"}
          </button>
        </div>
        {result ? <div className="mt-3"><Message kind={result.kind}>{result.text}</Message></div> : null}
      </Card>
    </div>
  );
}

/**
 * Admin → Frenz Coin → Transfers (Part 6). Recent transfers (GET /api/admin/wallet/coin-transfers, read-only), find one
 * by id, and correct it through the EXISTING route (POST /api/admin/wallet/coin-transfers/[id]/correct, 0283
 * correct_coin_transfer): fee refund once, or sender credits up to the transfer — re-checked in the database.
 */
export function CoinTransfers({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const list = useAdminRead<{ items: AdminCoinTransfer[] }>("/api/admin/wallet/coin-transfers");
  const [open, setOpen] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [findErr, setFindErr] = useState<string | null>(null);

  if (open) return <TransferDetail id={open} sensitiveFetch={sensitiveFetch} onBack={() => { setOpen(null); void list.reload(); }} />;

  return (
    <div className="space-y-5">
      <Card title="Find a transfer">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = find.trim();
            if (!/^[0-9a-f-]{36}$/i.test(id)) return setFindErr("Paste the full transfer id (from the admin alert or the member's receipt).");
            setFindErr(null);
            setOpen(id);
          }}
        >
          <input aria-label="Transfer id" className={`${INPUT} min-w-0 flex-1 font-mono`} placeholder="Transfer id" value={find} onChange={(e) => setFind(e.target.value)} />
          <button type="submit" className={`${BTN} bg-foreground text-background`}>Open</button>
        </form>
        {findErr ? <p className="mt-2 text-xs text-rose-600">{findErr}</p> : null}
      </Card>
      <Card title="Recent transfers" action={<button type="button" className={`${BTN} border border-border`} onClick={() => void list.reload()} disabled={list.loading || list.refreshing}>{list.refreshing ? "Refreshing…" : "Refresh"}</button>}>
        {list.loading ? (
          <p className="text-sm text-muted-foreground">Loading transfers…</p>
        ) : list.error && !list.data ? (
          <Message kind="error">{list.error}</Message>
        ) : !list.data?.items.length ? (
          <Empty>No coin transfers yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.items.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(t.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2.5 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="min-w-0">
                    <span className="font-semibold">{who(t.sender)} → {who(t.recipient)}</span>
                    <span className="block text-xs text-muted-foreground">{when(t.createdAt)} · fee {usd(t.feeCents)}{t.corrections.length ? ` · ${t.corrections.length} correction${t.corrections.length === 1 ? "" : "s"}` : ""}</span>
                  </span>
                  <span className="font-semibold">{usd(t.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
