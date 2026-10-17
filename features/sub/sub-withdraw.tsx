"use client";

import { Loader2, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EX_CARD, exPrimary } from "@/features/sub/ui";
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

const STATUS: Record<string, string> = { pending: "Requested", reviewing: "In review", approved: "Approved", processing: "Sending", completed: "Paid", rejected: "Declined", cancelled: "Cancelled", reversed: "Returned to balance" };

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
  /*
    Owner 2026-10-12: creators outside Nigeria. A Nigerian Paystack account can only pay
    Nigerian banks, so "Outside Nigeria" takes a bank wire (with SWIFT) or a PayPal email,
    and the withdrawal is paid by hand by the Frenz team after a review — never instantly.
  */
  const [where, setWhere] = useState<"ng" | "intl">("ng");
  const [intl, setIntl] = useState({ rail: "bank" as "bank" | "paypal", country: "", accountName: "", bankName: "", accountNumber: "", swift: "", email: "" });
  const intlOk =
    /^[A-Z]{2}$/.test(intl.country) && intl.country !== "NG" && intl.accountName.trim().length >= 2 &&
    (intl.rail === "paypal"
      ? /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(intl.email.trim())
      : intl.bankName.trim().length >= 2 && /^[0-9A-Za-z -]{4,40}$/.test(intl.accountNumber.trim()) && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(intl.swift.trim().toUpperCase()));
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
  const accountOk = where === "intl" ? intlOk : viaSaved || lookup.accountOk;
  const open = (e?.withdrawals ?? []).some((w) => ["pending", "reviewing", "approved", "processing"].includes(w.status));
  const valid = !!rules && !!e && rules.withdrawalsEnabled && !open && !!split && cents >= rules.minWithdrawalCents && cents <= e.availableCents && accountOk;

  const submit = async () => {
    if (!valid || busy) return;
    haptic("selection");
    setBusy(true);
    setMsg(null);
    // same request ⇒ same key (a retry is a replay, not a second payout)
    const sig = where === "intl" ? `${cents}:intl:${JSON.stringify(intl)}` : viaSaved ? `${cents}:saved` : `${cents}:${bankCode}:${acct}`;
    if (replay.current?.sig !== sig) replay.current = { sig, key: newKey() };
    const end = beginCriticalActivity();
    try {
      const res = await fetch("/api/sub/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(
          where === "intl"
            ? { grossCents: cents, idempotencyKey: replay.current.key, international: intl.rail === "paypal" ? { rail: "paypal", country: intl.country, accountName: intl.accountName.trim(), email: intl.email.trim() } : { rail: "bank", country: intl.country, accountName: intl.accountName.trim(), bankName: intl.bankName.trim(), accountNumber: intl.accountNumber.trim(), swift: intl.swift.trim().toUpperCase() } }
            : viaSaved
              ? { grossCents: cents, idempotencyKey: replay.current.key, useSaved: true }
              : { grossCents: cents, idempotencyKey: replay.current.key, details: { bankCode, bankName: lookup.bankName, accountNumber: acct } },
        ) });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; netCents?: number; paidOut?: boolean; status?: string } | null;
      if (res.ok && j?.ok) {
        replay.current = null;
        setAmount("");
        setMsg({ ok: true, text: where === "intl" ? `Requested. Our team will send ${usd(j.netCents ?? 0)} to your ${intl.rail === "paypal" ? "PayPal" : "bank"} after a quick review, and you'll be notified when it's paid.` : j.status === "completed" ? `${usd(j.netCents ?? 0)} is on its way to ${viaSaved ? savedAccount!.accountName : resolved.name}.` : j.paidOut ? `${usd(j.netCents ?? 0)} is being sent through Paystack.` : `Requested. ${usd(j.netCents ?? 0)} will be sent once it's reviewed.` });
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
    <div role="dialog" aria-modal="true" aria-label="Withdraw private post earnings" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={(ev) => ev.target === ev.currentTarget && !busy && onClose()}>
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto ex-card ex-sheet p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-[17px] font-bold">
            <Wallet className="h-4 w-4 text-emerald-600" aria-hidden /> Withdraw private post earnings
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="inline-flex h-10 w-10 items-center justify-center rounded-full transition active:bg-black/[0.06]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {!data ? (
          failed ? <p className="py-6 text-center text-[14px] text-muted-foreground">Couldn&apos;t load your private post balance. Try again in a moment.</p> : <div className="h-40 animate-pulse rounded-2xl bg-black/[0.05] motion-reduce:animate-none" aria-busy="true" />
        ) : (
          <>
            <div className={cn("grid grid-cols-2 gap-2 rounded-[22px] p-3", EX_CARD)}>
              <Stat label="Available" value={usd(e!.availableCents)} strong />
              <Stat label="Being paid out" value={usd(e!.heldCents)} />
              {e!.pendingCents > 0 ? <Stat label="Clearing" value={usd(e!.pendingCents)} /> : null}
              {e!.debtCents > 0 ? <Stat label="Owed back (refunds)" value={usd(e!.debtCents)} /> : null}
            </div>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Private post money is separate from AI credits. A {rules!.withdrawalFeePercent}% withdrawal fee applies. Minimum {usd(rules!.minWithdrawalCents)}. {where === "intl" ? "Outside Nigeria, our team pays it after a quick review." : rules!.autoPayout ? "Paid out through Paystack straight away." : "Paid through Paystack after a quick review."}
            </p>

            {!rules!.withdrawalsEnabled ? (
              <p className="mt-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-[13px] font-medium text-amber-800 dark:text-amber-300">Private post withdrawals are paused right now. Your balance is safe.</p>
            ) : open ? (
              <p className="mt-3 rounded-2xl bg-sky-500/10 px-3 py-2 text-[13px] font-medium text-sky-800 dark:text-sky-300">You have a withdrawal in progress. You can request another once it&apos;s finished.</p>
            ) : null}

            <label className="mt-3 block text-[13px] font-semibold" htmlFor="sw-amount">
              Amount (USD)
            </label>
            <div className="mt-1 flex gap-2">
              <input id="sw-amount" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, "").slice(0, 10))} placeholder="0.00" className={field} />
              <button type="button" onClick={() => setAmount((e!.availableCents / 100).toFixed(2))} className="ex-btn ex-btn--glass ex-btn--sm shrink-0">
                Max
              </button>
            </div>
            {split ? (
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {usd(split.grossCents)} − {usd(split.feeCents)} fee = <b className="text-foreground">{usd(split.netCents)}</b> to your bank
                {cents > e!.availableCents ? <span className="font-medium text-rose-600 dark:text-rose-400"> · more than you have available</span> : cents < rules!.minWithdrawalCents ? <span className="font-medium text-rose-600 dark:text-rose-400"> · below the minimum</span> : null}
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]" role="group" aria-label="Where should we pay you?">
              {(
                [
                  ["ng", "Nigerian bank"],
                  ["intl", "Outside Nigeria"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setWhere(id)} aria-pressed={where === id} className={cn("min-h-[2.5rem] rounded-xl text-[13.5px] font-semibold transition", where === id ? "bg-white text-foreground shadow-sm dark:bg-white/[0.16]" : "text-muted-foreground")}>
                  {label}
                </button>
              ))}
            </div>

            {where === "intl" ? (
              <IntlFields value={intl} onChange={setIntl} />
            ) : savedAccount && !useNew ? (
              <div className="mt-3 rounded-2xl bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.045]">
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

            {msg ? <p className={cn("mt-3 text-[13.5px] font-medium", msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{msg.text}</p> : null}
            <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={cn(exPrimary, "mt-3 w-full justify-center")}>
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
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", w.status === "completed" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : ["rejected", "cancelled"].includes(w.status) ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-sky-500/10 text-sky-700 dark:text-sky-300")}>{STATUS[w.status] ?? w.status}</span>
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


/** Every ISO country the browser can name, except Nigeria (paid through Paystack instead). */
function countries(): { code: string; name: string }[] {
  try {
    const dn = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
    const out: { code: string; name: string }[] = [];
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = dn.of(code);
        if (name && name !== code && code !== "NG" && !/^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/.test(code)) out.push({ code, name });
      }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  } catch {
    return [];
  }
}

type Intl_ = { rail: "bank" | "paypal"; country: string; accountName: string; bankName: string; accountNumber: string; swift: string; email: string };

/** Outside Nigeria: a bank wire (with SWIFT) or PayPal. Paid by hand — said plainly. */
function IntlFields({ value, onChange }: { value: Intl_; onChange: (v: Intl_) => void }) {
  const [list] = useState(countries);
  const set = (patch: Partial<Intl_>) => onChange({ ...value, ...patch });
  return (
    <div className="mt-3 space-y-2.5">
      <label className="block text-[13px] font-semibold" htmlFor="sw-country">
        Country
      </label>
      {list.length ? (
        <select id="sw-country" value={value.country} onChange={(e) => set({ country: e.target.value })} className={FIELD}>
          <option value="">Choose your country</option>
          {list.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      ) : (
        <input id="sw-country" value={value.country} onChange={(e) => set({ country: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) })} placeholder="Two-letter code, e.g. GH" className={FIELD} />
      )}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]" role="group" aria-label="Paid by">
        {(
          [
            ["bank", "Bank transfer"],
            ["paypal", "PayPal"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => set({ rail: id })} aria-pressed={value.rail === id} className={cn("min-h-[2.25rem] rounded-xl text-[13px] font-semibold transition", value.rail === id ? "bg-white text-foreground shadow-sm dark:bg-white/[0.16]" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <input aria-label="Account holder's full name" value={value.accountName} onChange={(e) => set({ accountName: e.target.value.slice(0, 120) })} placeholder="Account holder's full name" autoComplete="name" className={FIELD} />
      {value.rail === "paypal" ? (
        <input aria-label="PayPal email" type="email" value={value.email} onChange={(e) => set({ email: e.target.value.slice(0, 254) })} placeholder="PayPal email" autoComplete="email" className={FIELD} />
      ) : (
        <>
          <input aria-label="Bank name" value={value.bankName} onChange={(e) => set({ bankName: e.target.value.slice(0, 120) })} placeholder="Bank name" className={FIELD} />
          <input aria-label="IBAN or account number" value={value.accountNumber} onChange={(e) => set({ accountNumber: e.target.value.slice(0, 40) })} placeholder="IBAN or account number" autoComplete="off" className={FIELD} />
          <input aria-label="SWIFT / BIC code" value={value.swift} onChange={(e) => set({ swift: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) })} placeholder="SWIFT / BIC (8 or 11 characters)" autoComplete="off" className={FIELD} />
        </>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground">Paid by our team after a quick review, usually in USD. Your bank or PayPal may charge its own fee to receive it.</p>
    </div>
  );
}
