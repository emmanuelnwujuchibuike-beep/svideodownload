"use client";

import { Building2, Loader2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { exPrimary, exQuiet } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { BankFields, useBankLookup } from "./bank-fields";

/**
 * Payout account and AUTO-WITHDRAWAL (owner, 2026-10-11) — on the SUB POSTS tab
 * and the Members dashboard. Save a bank account once (Paystack names the
 * holder), and with auto-withdrawal on every new subscription is sent to it as it
 * arrives, less the withdrawal fee. The switch answers on the tap; a refusal puts
 * it back and says why.
 */

export interface PayoutAccountView {
  bankName: string;
  bankCode: string;
  last4: string;
  accountName: string;
  autoWithdraw: boolean;
  verifiedAt: string;
}

export function useSavedPayoutAccount() {
  const [state, setState] = useState<{ account: PayoutAccountView | null; ready: boolean; feePercent?: number } | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/sub/payout-account")
      .then((r) => (r.ok ? r.json() : { account: null, ready: false }))
      .then((j) => live && setState(j))
      .catch(() => live && setState({ account: null, ready: false }));
    return () => {
      live = false;
    };
  }, []);
  return [state, setState] as const;
}

export function SubPayoutSettings({ feePercent: feeProp, className }: { feePercent?: number; className?: string }) {
  const [state, setState] = useSavedPayoutAccount();
  const feePercent = feeProp ?? state?.feePercent ?? 10;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef(state);
  ref.current = state;
  const account = state?.account ?? null;

  const toggle = async () => {
    const before = ref.current;
    if (!before?.account) return;
    haptic("selection");
    const on = !before.account.autoWithdraw;
    setState({ ...before, account: { ...before.account, autoWithdraw: on } });
    setNote(null);
    const res = await fetch("/api/sub/payout-account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoWithdraw: on }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (!res?.ok) {
      setState(before);
      setNote({ ok: false, text: j?.error ?? "Couldn't save that." });
    } else if (on) setNote({ ok: true, text: "On. New subscriptions go straight to your bank." });
  };

  const remove = async () => {
    const before = ref.current;
    haptic("selection");
    setState({ account: null, ready: true });
    const res = await fetch("/api/sub/payout-account", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setState(before);
      setNote({ ok: false, text: "Couldn't remove it." });
    }
  };

  if (!state) return <div className={cn("h-24 animate-pulse rounded-[22px] bg-black/[0.04] motion-reduce:animate-none dark:bg-white/[0.06]", className)} aria-busy="true" />;
  if (!state.ready) return null;

  return (
    <div className={cn("rounded-[22px] bg-black/[0.03] p-3.5 dark:bg-white/[0.045]", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
          <Building2 className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">Payout account</p>
          {account && !editing ? (
            <p className="truncate text-[12.5px] text-muted-foreground">
              {account.bankName} ••••{account.last4} · {account.accountName}
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Save your bank once. Paystack confirms who it belongs to.</p>
          )}
        </div>
      </div>

      {account && !editing ? (
        <>
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.05]">
            <Zap className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold">Auto-withdrawal</span>
              <span className="block text-[12px] text-muted-foreground">Every new subscription goes straight to this account, less the {feePercent}% withdrawal fee.</span>
            </span>
            <button type="button" role="switch" aria-checked={account.autoWithdraw} aria-label="Auto-withdrawal" onClick={() => void toggle()} className="ex-switch" />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className={"ex-btn ex-btn--quiet ex-btn--sm"}>
              Change account
            </button>
            <button type="button" onClick={() => void remove()} className={"ex-btn ex-btn--danger ex-btn--sm"}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <AccountForm
          initialAuto={account?.autoWithdraw ?? true}
          canCancel={!!account}
          onCancel={() => setEditing(false)}
          onSaved={(a) => {
            setState({ account: a, ready: true });
            setEditing(false);
            setNote({ ok: true, text: a.autoWithdraw ? "Saved. Auto-withdrawal is on." : "Saved for your next withdrawal." });
          }}
        />
      )}
      {note ? <p className={cn("mt-2 text-[12.5px] font-medium", note.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{note.text}</p> : null}
    </div>
  );
}

function AccountForm({ initialAuto, canCancel, onCancel, onSaved }: { initialAuto: boolean; canCancel: boolean; onCancel: () => void; onSaved: (a: PayoutAccountView) => void }) {
  const lookup = useBankLookup();
  const [auto, setAuto] = useState(initialAuto);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!lookup.accountOk || busy) return;
    haptic("selection");
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/sub/payout-account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bankCode: lookup.bankCode, bankName: lookup.bankName, accountNumber: lookup.acct, autoWithdraw: auto }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { account?: PayoutAccountView; error?: string } | null;
    setBusy(false);
    if (res?.ok && j?.account) onSaved(j.account);
    else setErr(j?.error ?? "Couldn't save that account.");
  };
  return (
    <div>
      <BankFields lookup={lookup} idPrefix="payout" />
      <label className="mt-2 flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-emerald-600" /> Turn on auto-withdrawal
      </label>
      {err ? <p className="mt-2 text-[12.5px] font-medium text-rose-600 dark:text-rose-400">{err}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => void save()} disabled={!lookup.accountOk || busy} className={exPrimary}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? "Saving…" : "Save account"}
        </button>
        {canCancel ? (
          <button type="button" onClick={onCancel} className={exQuiet}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
