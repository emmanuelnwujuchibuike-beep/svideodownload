"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { cn } from "@/lib/utils";

import { type CoinWithdrawal, type WalletSummary, type WithdrawalQuote, walletApi } from "./api";
import { CoinAmount } from "./coin-amount";
import { coins, dateTimeLabel, fc, newKey, parseCoinInput } from "./money";
import { amountProblem, failMessage, withdrawGate, withdrawalStatusView } from "./state";
import { invalidateCoinGlance } from "./coin-glance";
import { loadBanksOnce, useLatestRequest } from "./use-wallet-runtime";
import { BankIcon, CheckIcon, LockIcon } from "./wallet-icons";
import { ActionBar, AmountEntry, DetailList, Notice, PillButton, PinField, SectionTitle, SessionExpired, StatusBadge, SubHeader, Unavailable, WalletScreen } from "./wallet-ui";

type Fail = { msg: string; expired: boolean };
type Bank = { name: string; code: string };
const OPEN = new Set(["pending", "reviewing", "approved", "processing"]);
const NAIRA = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });

/** The member's coin withdrawals and where each one stands (a bank return says so, and that the coins came back). */
function WithdrawalList({ items }: { items: CoinWithdrawal[] }) {
  if (!items.length) return <p className="mx-4 rounded-[22px] bg-frenz-fill/60 px-5 py-6 text-center text-sm text-frenz-muted">No withdrawals yet.</p>;
  return (
    <ul className="mx-4 flex flex-col rounded-[22px] border border-frenz-line px-4">
      {items.map((w, i) => {
        const v = withdrawalStatusView(w.status);
        return (
          <li key={w.id} className={cn("flex flex-col gap-1 py-3", i > 0 && "border-t border-frenz-line")}>
            <span className="flex items-center justify-between gap-3">
              <span className="font-heading text-[15px] font-bold text-frenz-ink">{fc(w.grossCents)}</span>
              <StatusBadge status={v.badge} />
            </span>
            <span className="text-[12.5px] text-frenz-muted">
              {dateTimeLabel(w.createdAt)} · {w.bank.name ?? "Bank"}
              {w.bank.last4 ? ` ••${w.bank.last4}` : ""}
            </span>
            <span className="text-[12.5px] text-frenz-muted">
              Fee {fc(w.feeCents)} · you receive ${coins(w.netCents)}
              {w.payout ? ` (${NAIRA.format(w.payout.minor / 100)})` : ""}
            </span>
            {v.message ? <span className="text-[12.5px] text-frenz-ink">{v.message}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * /wallet/withdraw (design: Withdraw). Amount → bank → Review: the SERVER prices it (6% from the gross) and the member
 * confirms with their PIN. Nothing is paid on the tap — the coins are held and an administrator approves the payout, so
 * the screen promises no speed. Closed when withdrawals are off or no payout rate is approved.
 */
export function WalletWithdraw({ summary, withdrawals }: { summary: WalletSummary; withdrawals: CoinWithdrawal[] | null }) {
  const router = useRouter();
  const [raw, setRaw] = useStickyState("wallet-withdraw-amount", 0, "");
  const [bankCode, setBankCode] = useStickyState("wallet-withdraw-bank", 0, "");
  const [account, setAccount] = useStickyState("wallet-withdraw-account", 0, "");
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [banksError, setBanksError] = useState<Fail | null>(null);
  const [touched, setTouched] = useState(false);
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<Fail | null>(null);
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Fail | null>(null);
  const [done, setDone] = useState<{ id: string; grossCents: number; feeCents: number; netCents: number; duplicate: boolean } | null>(null);
  const key = useRef<{ sig: string; key: string } | null>(null);
  const latest = useLatestRequest();
  const gate = withdrawGate(summary);

  // the bank list: once per session (shared, deduped), and only when the form can actually be used
  useEffect(() => {
    if (!gate.open) return;
    let live = true;
    void loadBanksOnce().then((r) => {
      if (!live) return;
      if (r.ok) setBanks(r.data.banks);
      else setBanksError({ msg: r.status === 503 ? "The bank list isn't available right now. Try again in a moment." : failMessage(r, "load"), expired: r.session === "expired" });
    });
    return () => {
      live = false;
    };
  }, [gate.open]);

  const history = withdrawals ?? [];
  const historyBlock = (
    <>
      <SectionTitle>Your withdrawals</SectionTitle>
      {withdrawals ? <WithdrawalList items={history} /> : <Notice tone="error">Couldn&apos;t load your withdrawals. Pull down to try again.</Notice>}
    </>
  );

  if (!gate.open)
    return (
      <WalletScreen label="Withdraw">
        <SubHeader title="Withdraw" />
        <Unavailable title={gate.title} action={gate.action}>
          {gate.message}
        </Unavailable>
        {history.length ? historyBlock : null}
      </WalletScreen>
    );

  const w = summary.withdrawals;
  const cents = parseCoinInput(raw);
  const problem = amountProblem(cents, w, summary.availableCents);
  const maxCents = Math.min(summary.availableCents, w.maxCents);
  const bank = banks?.find((b) => b.code === bankCode) ?? null;
  const accountOk = /^\d{10}$/.test(account);
  const openOne = history.find((x) => OPEN.has(x.status));

  const review = async () => {
    setTouched(true);
    if (problem || cents == null || !bank || !accountOk || quoting || openOne) return;
    setQuoting(true);
    setQuoteError(null);
    const r = await latest((signal) => walletApi.quote("withdrawal", cents, signal));
    if (!r) return;
    setQuoting(false);
    if (!r.ok || r.data.kind !== "withdrawal") return setQuoteError({ msg: r.ok ? "Couldn't price this withdrawal." : failMessage(r, "withdrawal"), expired: !r.ok && r.session === "expired" });
    if (!r.data.payoutRateApproved) return setQuoteError({ msg: "Withdrawals aren't open yet — no payout rate is approved. Nothing was held.", expired: false });
    const sig = `${cents}:${bank.code}:${account}`;
    if (!key.current || key.current.sig !== sig) key.current = { sig, key: newKey("cwd") };
    setPin("");
    setSendError(null);
    setQuote(r.data);
  };

  const confirm = async () => {
    if (!quote || !bank || !key.current || sending || pin.length !== 6) return;
    setSending(true);
    setSendError(null);
    const r = await walletApi.withdraw({ grossCents: quote.grossCents, bankCode: bank.code, bankName: bank.name, accountNumber: account, idempotencyKey: key.current.key, pin });
    setSending(false);
    setPin("");
    if (!r.ok) return setSendError({ msg: failMessage(r, "withdrawal"), expired: r.session === "expired" });
    setQuote(null);
    setDone(r.data);
    setRaw("");
    setAccount("");
    key.current = null;
    // coins are now held: refresh this page's list and drop the cached wallet (and the entry points' balance)
    invalidateCoinGlance();
    router.refresh();
  };

  return (
    <WalletScreen label="Withdraw">
      <SubHeader title="Withdraw" />

      {done ? (
        <Notice tone="success" title={done.duplicate ? "Already requested" : "Withdrawal requested"} className="mt-4">
          {done.duplicate ? "This request was already received — nothing was held twice. " : ""}
          {fc(done.grossCents)} is held while we review it. You&apos;ll receive ${coins(done.netCents)} after the {fc(done.feeCents)} fee. We&apos;ll notify you when it&apos;s paid.
        </Notice>
      ) : null}

      {openOne && !done ? (
        <Notice tone="warn" title="You have a withdrawal in progress" className="mt-4">
          One withdrawal at a time. You can request another once {fc(openOne.grossCents)} is paid or returned.
        </Notice>
      ) : null}

      <div className="mt-6">
        <AmountEntry id="withdraw-amount" label="Amount to withdraw" value={raw} onChange={setRaw} hint={cents ? `≈ $${coins(cents)} USD before the fee` : `${fc(summary.availableCents)} available`} />
      </div>
      {maxCents >= w.minCents ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => setRaw(String(maxCents / 100))} className="h-9 rounded-full bg-frenz-fill px-4 text-[13px] font-bold text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
            Max {coins(maxCents)}
          </button>
        </div>
      ) : null}
      {touched && problem ? (
        <p role="alert" className="mx-5 mt-2 text-center text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {problem}
        </p>
      ) : null}

      <SectionTitle>To</SectionTitle>
      <div className="mx-4 flex flex-col gap-3 rounded-[22px] border border-frenz-line p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-frenz-ink text-frenz-page">
            <BankIcon size={20} />
          </span>
          <label htmlFor="withdraw-bank" className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-frenz-muted">Bank</span>
            <select id="withdraw-bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} disabled={!banks} className="h-10 w-full rounded-xl bg-frenz-fill px-2.5 text-[15px] font-semibold text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue disabled:opacity-60">
              <option value="">{banks ? "Choose your bank" : "Loading banks…"}</option>
              {banks?.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor="withdraw-account" className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-frenz-muted">Account number</span>
          <input id="withdraw-account" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="10 digits" value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 10))} className="h-12 rounded-xl bg-frenz-fill px-3 text-[15px] font-semibold tracking-[0.06em] text-frenz-ink outline-none placeholder:text-frenz-muted focus-visible:ring-2 focus-visible:ring-frenz-blue" />
        </label>
        <span className="text-[12px] text-frenz-muted">The account holder&apos;s name is confirmed with the bank before anything is held.</span>
      </div>
      {banksError ? <div className="mt-3">{banksError.expired ? <SessionExpired next="/wallet/withdraw" /> : <Notice tone="error">{banksError.msg}</Notice>}</div> : null}
      {touched && (!bank || !accountOk) ? (
        <p role="alert" className="mx-5 mt-2 text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {!bank ? "Choose your bank." : "Enter your 10-digit account number."}
        </p>
      ) : null}

      <SectionTitle>Summary</SectionTitle>
      <DetailList
        rows={[
          ["Amount", cents ? `${fc(cents)}` : "—"],
          ["Fee", `${(w.percentBp / 100).toFixed(w.percentBp % 100 ? 2 : 0)}% of the amount${w.flatCents ? ` + ${fc(w.flatCents)}` : ""}`],
          ["Paid in", "Naira, at the approved payout rate"],
        ]}
        total={["You receive", "Shown at review"]}
      />
      <p className="mx-5 mt-2 text-[12.5px] text-frenz-muted">The fee comes out of the amount you withdraw. Each request is reviewed before it&apos;s paid.</p>

      {quoteError ? <div className="mt-3">{quoteError.expired ? <SessionExpired next="/wallet/withdraw" /> : <Notice tone="error">{quoteError.msg}</Notice>}</div> : null}

      {historyBlock}

      <ActionBar>
        <PillButton tone="ink" onClick={() => void review()} disabled={quoting || !!openOne} aria-busy={quoting}>
          {quoting ? "Working out the fee…" : "Review withdrawal"}
        </PillButton>
      </ActionBar>

      <GlassSheetShell open={!!quote} onClose={() => (sending ? undefined : setQuote(null))} title="Review withdrawal" fitContent defaultHeightVh={88}>
        {quote && bank ? (
          <form
            className="frenz-ui flex flex-col gap-4 px-1 pb-8 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-sm text-frenz-muted">You&apos;re withdrawing</span>
              <CoinAmount cents={quote.grossCents} className="text-[40px] font-extrabold leading-tight tracking-[-1.5px] text-frenz-ink" />
            </div>
            <DetailList
              className="mx-0"
              rows={[
                ["To", `${bank.name} ••${account.slice(-4)}`],
                ["Amount", `${fc(quote.grossCents)}`],
                ["Fee", `${fc(quote.feeCents)}`],
                ["Wallet after", `${fc(summary.availableCents - quote.grossCents)}`],
              ]}
              total={["You receive", `$${coins(quote.netCents)}`]}
            />
            <p className="flex items-start gap-2 text-[12.5px] text-frenz-muted">
              <CheckIcon size={16} className="mt-px shrink-0" /> Paid in naira at the approved rate. The coins are held while the request is reviewed; if the bank sends the payment back, they return to your wallet.
            </p>
            <PinField id="withdraw-pin" label="Your 6-digit transaction PIN" value={pin} onChange={setPin} autoFocus disabled={sending} />
            {sendError ? sendError.expired ? <SessionExpired next="/wallet/withdraw" /> : <Notice tone="error" className="mx-0">{sendError.msg}</Notice> : null}
            <PillButton type="submit" tone="ink" disabled={sending || pin.length !== 6} aria-busy={sending}>
              <LockIcon size={17} />
              {sending ? "Requesting…" : `Withdraw $${coins(quote.netCents)}`}
            </PillButton>
          </form>
        ) : null}
      </GlassSheetShell>
    </WalletScreen>
  );
}
