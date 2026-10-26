"use client";

import { useState } from "react";

import type { AdminCoinWithdrawal } from "@/lib/coin/withdrawals";

import { type WithdrawalAction, WITHDRAWAL_STATUS, withdrawalActions } from "./coin-admin-logic";
import { postMoney, useAdminRead } from "./coin-admin-data";
import { BTN, Badge, Card, Empty, INPUT, Message, naira, usd, when } from "./coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type List = { open: AdminCoinWithdrawal[]; recent: AdminCoinWithdrawal[] };

function fxText(w: AdminCoinWithdrawal): string {
  const f = w.payoutFx;
  if (!f || !f.source) return w.payout ? "Recorded at request" : "Not recorded yet — set when paid";
  if (f.source === "fixed" && f.minorPerUsd) return `Fixed ${naira(f.minorPerUsd)} per $1${f.at ? ` · ${when(f.at)}` : ""}`;
  if (f.source === "market" && f.perUsd) return `Market ₦${f.perUsd} per $1${f.provider ? ` (${f.provider})` : ""}${f.at ? ` · ${when(f.at)}` : ""}`;
  return f.source;
}

/**
 * Admin → Frenz Coin → Withdrawals (Part 6). The list is GET /api/admin/wallet/coin-withdrawals; every action is the
 * EXISTING withdrawal route — review / approve / reject: POST /api/admin/rewards/withdrawals/[id]; pay: POST
 * /api/admin/rewards/withdrawals/[id]/paystack — each with a fresh password, audited, and moved only along the legal
 * transitions by the database. Amounts, fees, payouts and rates shown are the server's; nothing typed here prices anything.
 */
export function CoinWithdrawals({ sensitiveFetch, payoutRateApproved }: { sensitiveFetch: SensitiveFetch; payoutRateApproved: boolean }) {
  const list = useAdminRead<List>("/api/admin/wallet/coin-withdrawals");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; kind: "ok" | "error"; text: string; confirmNotSent?: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; note: string; notSent: boolean } | null>(null);

  const act = async (w: AdminCoinWithdrawal, action: WithdrawalAction, extra?: { note?: string; confirmNotSent?: boolean }) => {
    if (busy) return;
    setBusy(w.id);
    setMsg(null);
    const r =
      action === "pay"
        ? await postMoney<{ ok: true; provider?: string; status?: string }>(sensitiveFetch, `/api/admin/rewards/withdrawals/${w.id}/paystack`)
        : await postMoney<{ ok: true; outcome?: string }>(sensitiveFetch, `/api/admin/rewards/withdrawals/${w.id}`, {
            status: action === "review" ? "reviewing" : action === "approve" ? "approved" : "rejected",
            ...(extra?.note ? { note: extra.note } : {}),
            ...(extra?.confirmNotSent ? { confirmNotSent: true } : {}),
          });
    setBusy(null);
    if (!r.ok) return setMsg({ id: w.id, kind: "error", text: r.error, confirmNotSent: r.reason === "confirm_not_sent" });
    setRejecting(null);
    const done: Record<WithdrawalAction, string> = { review: "Moved to review.", approve: "Approved.", pay: "Payout sent to the provider. It shows as paid once the provider confirms.", reject: "Rejected — the coins went back to the member's wallet." };
    setMsg({ id: w.id, kind: "ok", text: action === "reject" && (r.data as { outcome?: string }).outcome === "completed_instead" ? "The provider had already paid it, so it was recorded as paid instead." : done[action] });
    void list.reload();
  };

  const row = (w: AdminCoinWithdrawal) => {
    const s = WITHDRAWAL_STATUS[w.status] ?? { label: w.status, tone: "gray" as const };
    const actions = withdrawalActions(w.status, payoutRateApproved);
    const mine = msg?.id === w.id ? msg : null;
    return (
      <li key={w.id} className="rounded-2xl border border-border p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {w.member.name || (w.member.handle ? `@${w.member.handle}` : "Member")} {w.member.handle && w.member.name ? <span className="font-normal text-muted-foreground">@{w.member.handle}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {when(w.createdAt)} · {w.bank.name ?? "Bank"} {w.bank.last4 ? `••${w.bank.last4}` : ""} · <span className="font-mono">{w.id.slice(0, 8)}</span>
            </p>
          </div>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Requested</dt><dd className="font-semibold">{usd(w.grossCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Fee (earned)</dt><dd className="font-semibold">{usd(w.feeCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Net to member</dt><dd className="font-semibold">{usd(w.netCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Payout</dt><dd className="font-semibold">{w.payout ? `${w.payout.currency === "NGN" ? naira(w.payout.minor) : `${w.payout.currency} ${(w.payout.minor / 100).toFixed(2)}`}` : "—"}</dd></div>
          <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-muted-foreground">Exchange rate snapshot</dt><dd>{fxText(w)}</dd></div>
          {w.reference ? <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-muted-foreground">Payout reference</dt><dd className="break-all font-mono text-xs">{w.reference}</dd></div> : null}
        </dl>

        {actions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.includes("review") ? <button type="button" className={`${BTN} border border-border`} disabled={!!busy} onClick={() => void act(w, "review")}>Start review</button> : null}
            {actions.includes("approve") ? <button type="button" className={`${BTN} border border-border`} disabled={!!busy} onClick={() => void act(w, "approve")}>Approve</button> : null}
            {actions.includes("pay") ? (
              <button type="button" className={`${BTN} bg-emerald-600 text-white`} disabled={!!busy} aria-busy={busy === w.id} onClick={() => { if (window.confirm(`Send ${usd(w.netCents)} to ${w.bank.name ?? "the bank"} ••${w.bank.last4 ?? ""} now?`)) void act(w, "pay"); }}>
                {busy === w.id ? "Sending…" : "Pay to bank"}
              </button>
            ) : null}
            {actions.includes("reject") ? <button type="button" className={`${BTN} border border-rose-500/50 text-rose-700 dark:text-rose-300`} disabled={!!busy} onClick={() => setRejecting({ id: w.id, note: "", notSent: false })}>Reject…</button> : null}
          </div>
        ) : w.status === "approved" && !payoutRateApproved ? (
          <p className="mt-3 text-xs text-muted-foreground">Paying needs an approved payout rate (Settings → Payout rate).</p>
        ) : w.status === "processing" ? (
          <p className="mt-3 text-xs text-muted-foreground">Waiting for the payout provider to confirm.</p>
        ) : null}

        {rejecting?.id === w.id ? (
          <div className="mt-3 space-y-2 rounded-xl bg-rose-500/5 p-3">
            <label htmlFor={`rej-${w.id}`} className="text-xs font-semibold">Why is it rejected? (kept in the audit log)</label>
            <input id={`rej-${w.id}`} className={INPUT} value={rejecting.note} maxLength={500} onChange={(e) => setRejecting({ ...rejecting, note: e.target.value })} />
            {mine?.confirmNotSent ? (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={rejecting.notSent} onChange={(e) => setRejecting({ ...rejecting, notSent: e.target.checked })} />
                I checked the provider dashboard: this transfer was never sent.
              </label>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className={`${BTN} bg-rose-600 text-white`} disabled={!!busy || rejecting.note.trim().length < 3 || (mine?.confirmNotSent && !rejecting.notSent)} onClick={() => void act(w, "reject", { note: rejecting.note.trim(), confirmNotSent: rejecting.notSent })}>
                {busy === w.id ? "Rejecting…" : "Reject and return the coins"}
              </button>
              <button type="button" className={`${BTN} border border-border`} onClick={() => setRejecting(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {mine ? <div className="mt-3"><Message kind={mine.kind}>{mine.text}</Message></div> : null}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {!payoutRateApproved ? <Message kind="info">No payout rate is approved, so no coin withdrawal can be paid. Requests can still be reviewed and rejected.</Message> : null}
      <Card title={`Open requests${list.data ? ` (${list.data.open.length})` : ""}`} action={<button type="button" className={`${BTN} border border-border`} onClick={() => void list.reload()} disabled={list.loading || list.refreshing}>{list.refreshing ? "Refreshing…" : "Refresh"}</button>}>
        {list.loading ? <p className="text-sm text-muted-foreground">Loading withdrawals…</p> : list.error && !list.data ? <Message kind="error">{list.error}</Message> : list.data && list.data.open.length === 0 ? <Empty>No open coin withdrawals.</Empty> : <ul className="space-y-3">{list.data?.open.map(row)}</ul>}
        {list.error && list.data ? <div className="mt-3"><Message kind="error">{list.error}</Message></div> : null}
      </Card>
      <Card title="Recently finished">
        {list.data && list.data.recent.length === 0 ? <Empty>Nothing finished yet.</Empty> : <ul className="space-y-3">{list.data?.recent.map(row)}</ul>}
      </Card>
    </div>
  );
}
