"use client";

import { useState } from "react";

import { postMoney, useAdminRead, useReplayKey } from "./coin-admin-data";
import { BTN, Card, Empty, Field, INPUT, Message, usd, when } from "./coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Lookup = { recipient: { name: string; handle: string | null } | null; recent: { id: string; user_id: string; amount_cents: number; reason: string; created_at: string }[] };

/**
 * Admin → Frenz Coin → Fund a wallet (0301). Manual funding through the one guarded door: the dashboard is unlocked,
 * the account password is fresh (sensitiveFetch prompts), and the admin's PIN is typed for THIS funding. The wallet's
 * owner is shown before sending. One replay key per intended funding, so a retry never credits twice.
 * Caps: $1,000 per funding, $5,000 per admin in 24 hours (migration 0301).
 */
export function CoinFund({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const [account, setAccount] = useState("");
  const [dollars, setDollars] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const keyFor = useReplayKey();
  const valid = /^[0-9]{10}$/.test(account);
  const look = useAdminRead<Lookup>(`/api/admin/wallet/coin-fund${valid ? `?account=${account}` : ""}`);
  const cents = Math.round(Number(dollars) * 100);
  const recipient = valid ? look.data?.recipient : null;

  const send = async () => {
    if (busy) return;
    if (!recipient) return setMsg({ kind: "error", text: "Enter a 10-digit wallet number that belongs to a member." });
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000) return setMsg({ kind: "error", text: "The amount is $0.01 to $1,000." });
    if (reason.trim().length < 5) return setMsg({ kind: "error", text: "Give a reason (5+ characters). It is kept in the audit log." });
    if (!/^[0-9]{6}$/.test(pin)) return setMsg({ kind: "error", text: "Enter your 6-digit admin PIN." });
    if (!window.confirm(`Credit ${usd(cents)} in Frenz Coins to ${recipient.name}? This can't be undone here.`)) return;
    setBusy(true);
    setMsg(null);
    const idempotencyKey = keyFor(`${account}:${cents}:${reason.trim()}`);
    const r = await postMoney<{ ok: true; duplicate: boolean }>(sensitiveFetch, "/api/admin/wallet/coin-fund", { accountNumber: account, amountCents: cents, reason: reason.trim(), pin, idempotencyKey });
    setBusy(false);
    setPin("");
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setMsg({ kind: "ok", text: r.data.duplicate ? "Already sent — this is the same funding. Nothing was credited twice." : `${usd(cents)} credited to ${recipient.name}.` });
    setDollars("");
    setReason("");
    void look.reload();
  };

  return (
    <div className="space-y-5">
      <Card title="Fund a wallet">
        <p className="mb-3 text-xs text-muted-foreground">Credits spendable Frenz Coins to a member&apos;s wallet. Needs your admin PIN every time. Up to $1,000 per funding and $5,000 per admin in 24 hours. Every funding is permanent in the ledger and the audit log.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="fund-acct" label="Wallet number" hint={valid ? (look.loading ? "Looking it up…" : recipient ? `${recipient.name}${recipient.handle ? ` · @${recipient.handle}` : ""}` : "No wallet has this number.") : "10 digits"}>
            <input id="fund-acct" inputMode="numeric" className={`${INPUT} font-mono`} value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 10))} />
          </Field>
          <Field htmlFor="fund-amt" label="Amount (USD)">
            <input id="fund-amt" inputMode="decimal" className={INPUT} placeholder="0.00" value={dollars} onChange={(e) => setDollars(e.target.value.replace(/[^0-9.]/g, ""))} />
          </Field>
          <Field htmlFor="fund-why" label="Reason">
            <input id="fund-why" className={INPUT} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field htmlFor="fund-pin" label="Your admin PIN">
            <input id="fund-pin" type="password" inputMode="numeric" autoComplete="off" className={`${INPUT} tracking-[0.4em]`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
        </div>
        {msg ? <div className="mt-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
        <button type="button" onClick={() => void send()} disabled={busy} className={`${BTN} mt-4 bg-foreground text-background`}>
          {busy ? "Sending…" : "Fund wallet"}
        </button>
      </Card>
      <Card title="Recent fundings">
        {look.data?.recent.length ? (
          <ul className="divide-y divide-border text-sm">
            {look.data.recent.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{f.reason}</span>
                <span className="shrink-0 tabular-nums">{usd(f.amount_cents)} · {when(f.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No manual fundings yet.</Empty>
        )}
      </Card>
    </div>
  );
}
