"use client";

import { Loader2, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GLASS, primaryPill } from "@/features/friends/ui";
import { usd, withdrawalSplit } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
import { cn } from "@/lib/utils";

import { BankFields, FIELD, useBankLookup } from "./bank-fields";
import { useSavedPayoutAccount } from "./payout-settings";

/**
 * SUB withdrawal (0227, owner briefs 2026-10-11). The money a creator's paid
 * subscribers sent them, out to their bank through Paystack.
 *
 * The browser sends three things: the amount, the bank and a replay key. The
 * balance, the fee, the account holder's name and every rule come from the
 * server — the fee shown here is the same pure function the server charges, so
 * the preview can't drift from the payout. The replay key is minted once per
 * submission and reused on a retry, so a double tap or a flaky network can never
 * pay twice.
 */

export interface SubRules {
  withdrawalsEnabled: boolean;
  withdrawalFeePercent: number;
  minWithdrawalCents: number;
  autoPayout: boolean;
  requireQualification: boolean;
}

export interface SubEarningsView {
  pendingCents: number;
  availableCents: number;
  heldCents: number;
  debtCents: number;
  lifetimeCents: number;
  withdrawnCents: number;
  activeSubscribers: number;
  withdrawals: { id: string; status: string; grossCents: number; feeCents: number; netCents: number; at: string; reference: string | null }[];
  ready: boolean;
}

const STATUS: Record<string, string> = { pending: "Requested", reviewing: "In review", approved: "Approved", processing: "Sending", completed: "Paid", rejected: "Declined", cancelled: "Cancelled" };

export function useSubEarnings(enabled = true) {
  const [data, setData] = useState<{ earnings: SubEarningsView; rules: SubRules } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () =>
    fetch("/api/sub/earnings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setData(j))
      .catch(() => setFailed(true));
  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);
  return { data, failed, reload: load };
}

function newKey() {
  return `sw_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function SubWithdrawSheet({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { data, failed, reload } = useSubEarnings();
  const [amount, setAmount] = useState("");
  const lookup = useBankLookup();
  const [saved] = useSavedPayoutAccount();
  const [useNew, setUseNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const replay = useRef<{ sig: string; key: string } | null>(null);
  const savedAccount = saved?.account ?? null;
  const viaSaved = !!savedAccount && !useNew;
  const { bankCode, acct, resolved } = lookup;

  const rules = data?.rules;
  const e = data?.earnings;
  const cents = Math.round(Number(amount) * 100);
  const split = rules && Number.isFinite(cents) && cents > 0 ? withdrawalSplit(cents, rules.withdrawalFeePercent) : null;
  const accountOk = viaSaved || lookup.accountOk;
  const open = (e?.withdrawals ?? []).some((w) => ["pending", "reviewing", "approved", "processing"].includes(w.status));
  const valid = !!rules && !!e && rules.withdrawalsEnabled && !open && !!split && cents >= rules.minWithdrawalCents && cents <= e.availableCents && accountOk;

  const submit = async () => {
    if (!valid || busy) return;
    haptic("selection");
    setBusy(true);
    setMsg(null);
    // same request ⇒ same key (a retry is a replay, not a second payout)
    const sig = viaSaved ? `${cents}:saved` : `${cents}:${bankCode}:${acct}`;
    if (replay.current?.sig !== sig) replay.current = { sig, key: newKey() };
    const end = beginCriticalActivity();
    try {
      const res = await fetch("/api/sub/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(viaSaved ? { grossCents: cents, idempotencyKey: replay.current.key, useSaved: true } : { grossCents: cents, idempotencyKey: replay.current.key, details: { bankCode, bankName: lookup.bankName, accountNumber: acct } }) });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; netCents?: number; paidOut?: boolean; status?: string } | null;
      if (res.ok && j?.ok) {
        replay.current = null;
        setAmount("");
        setMsg({ ok: true, text: j.status === "completed" ? `${usd(j.netCents ?? 0)} is on its way to ${viaSaved ? savedAccount!.accountName : resolved.name}.` : j.paidOut ? `${usd(j.netCents ?? 0)} is being sent through Paystack.` : `Requested. ${usd(j.netCents ?? 0)} will be sent once it's reviewed.` });
        void reload();
        onDone?.();
      } else {
        setMsg({ ok: false, text: j?.error ?? "Couldn't request that withdrawal." });
      }
    } catch {
      setMsg({ ok: false, text: "No connection. Try again — you won't be paid twice." });
    } finally {
      end();
      setBusy(false);
    }
  };

  const field = FIELD;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Withdraw SUB earnings" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={(ev) => ev.target === ev.currentTarget && !busy && onClose()}>
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-background p-4 sm:rounded-[28px]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-[17px] font-bold">
            <Wallet className="h-4 w-4 text-emerald-600" aria-hidden /> Withdraw SUB earnings
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="inline-flex h-10 w-10 items-center justify-center rounded-full transition active:bg-black/[0.06]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {!data ? (
          failed ? <p className="py-6 text-center text-[14px] text-muted-foreground">Couldn&apos;t load your SUB balance. Try again in a moment.</p> : <div className="h-40 animate-pulse rounded-2xl bg-black/[0.05] motion-reduce:animate-none" aria-busy="true" />
        ) : (
          <>
            <div className={cn("grid grid-cols-2 gap-2 rounded-[22px] p-3", GLASS)}>
              <Stat label="Available" value={usd(e!.availableCents)} strong />
              <Stat label="Being paid out" value={usd(e!.heldCents)} />
              {e!.pendingCents > 0 ? <Stat label="Clearing" value={usd(e!.pendingCents)} /> : null}
              {e!.debtCents > 0 ? <Stat label="Owed back (refunds)" value={usd(e!.debtCents)} /> : null}
            </div>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              SUB money is separate from AI credits. A {rules!.withdrawalFeePercent}% withdrawal fee applies. Minimum {usd(rules!.minWithdrawalCents)}. {rules!.autoPayout ? "Paid out through Paystack straight away." : "Paid through Paystack after a quick review."}
            </p>

            {!rules!.withdrawalsEnabled ? (
              <p className="mt-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-[13px] font-medium text-amber-800 dark:text-amber-300">SUB withdrawals are paused right now. Your balance is safe.</p>
            ) : open ? (
              <p className="mt-3 rounded-2xl bg-sky-500/10 px-3 py-2 text-[13px] font-medium text-sky-800 dark:text-sky-300">You have a withdrawal in progress. You can request another once it&apos;s finished.</p>
            ) : null}

            <label className="mt-3 block text-[13px] font-semibold" htmlFor="sw-amount">
              Amount (USD)
            </label>
            <div className="mt-1 flex gap-2">
              <input id="sw-amount" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, "").slice(0, 10))} placeholder="0.00" className={field} />
              <button type="button" onClick={() => setAmount((e!.availableCents / 100).toFixed(2))} className="shrink-0 rounded-2xl border border-border px-3 text-[13px] font-semibold transition active:scale-95">
                Max
              </button>
            </div>
            {split ? (
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {usd(split.grossCents)} − {usd(split.feeCents)} fee = <b className="text-foreground">{usd(split.netCents)}</b> to your bank
                {cents > e!.availableCents ? <span className="font-medium text-rose-600"> · more than you have available</span> : cents < rules!.minWithdrawalCents ? <span className="font-medium text-rose-600"> · below the minimum</span> : null}
              </p>
            ) : null}

            {savedAccount && !useNew ? (
              <div className="mt-3 rounded-2xl border border-border/70 px-3 py-2.5">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">To your saved account</p>
                <p className="mt-0.5 text-[14px] font-semibold">
                  {savedAccount.bankName} ••••{savedAccount.last4}
                </p>
                <p className="text-[12.5px] text-muted-foreground">{savedAccount.accountName}</p>
                <button type="button" onClick={() => setUseNew(true)} className="mt-1 text-[12.5px] font-semibold text-primary">
                  Use a different account
                </button>
              </div>
            ) : (
              <BankFields lookup={lookup} idPrefix="sw" />
            )}

            {msg ? <p className={cn("mt-3 text-[13.5px] font-medium", msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600")}>{msg.text}</p> : null}
            <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={cn(primaryPill, "mt-3 w-full justify-center")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ? "Sending…" : split && valid ? `Withdraw ${usd(split.netCents)}` : "Withdraw"}
            </button>

            {e!.withdrawals.length ? (
              <div className="mt-5">
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">History</h3>
                <ul className="mt-2 divide-y divide-border/60">
                  {e!.withdrawals.map((w) => (
                    <li key={w.id} className="flex items-center justify-between py-2 text-[13.5px]">
                      <span>
                        {usd(w.netCents)} <span className="text-muted-foreground">({usd(w.grossCents)} − {usd(w.feeCents)} fee)</span>
                        <span className="block text-[12px] text-muted-foreground">{new Date(w.at).toLocaleDateString()}</span>
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", w.status === "completed" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : ["rejected", "cancelled"].includes(w.status) ? "bg-rose-500/10 text-rose-600" : "bg-sky-500/10 text-sky-700 dark:text-sky-300")}>{STATUS[w.status] ?? w.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-[20px] font-extrabold" : "text-[15px] font-bold")}>{value}</p>
    </div>
  );
}
