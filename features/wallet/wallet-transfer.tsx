"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { Avatar } from "@/features/frenz-ui/primitives";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { useStickyState } from "@/features/ui/use-sticky-state";

import { type TransferQuote, type WalletSummary, walletApi } from "./api";
import { CoinAmount } from "./coin-amount";
import { dateTimeLabel, fc, newKey, parseCoinInput, transferFeeNotice, walletDigits, walletNumber } from "./money";
import { amountProblem, failMessage, transferGate } from "./state";
import { invalidateCoinGlance } from "./coin-glance";
import { TapPending } from "./tap-pending";
import { useLatestRequest } from "./use-wallet-runtime";
import { CheckIcon, CloseIcon, CopyIcon, InfoIcon, LockIcon, SearchIcon } from "./wallet-icons";
import { ActionBar, AmountEntry, DetailList, Notice, PillButton, PinField, SessionExpired, StatusBadge, SubHeader, Unavailable, WalletScreen } from "./wallet-ui";

type Recipient = { number: string; name: string; handle: string | null; avatarUrl: string | null };
type Sent = { transferId: string; amountCents: number; feeCents: number; totalCents: number; duplicate: boolean; at: string; to: Recipient; note: string | null };
type Fail = { msg: string; expired: boolean };

/** The design's Receipt — shown ONLY after the server answered `ok` (its own amount, fee, total and transfer id). */
function TransferReceipt({ sent }: { sent: Sent }) {
  const [copied, setCopied] = useState(false);
  return (
    <WalletScreen label="Transfer receipt">
      <header className="flex justify-end px-4 pt-3">
        <Link href="/wallet" prefetch={false} aria-label="Close" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-frenz-fill text-frenz-ink outline-none transition active:scale-90 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none">
          <TapPending>
            <CloseIcon size={20} />
          </TapPending>
        </Link>
      </header>
      <div className="flex flex-col items-center gap-2 px-5 pt-2 text-center" role="status">
        <span className="flex h-[84px] w-[84px] rounded-full bg-frenz-gradient p-[3px] shadow-[0_18px_36px_-16px_hsl(var(--frenz-violet)/0.8)]">
          <span className="flex flex-1 items-center justify-center rounded-full bg-frenz-page text-frenz-violet">
            <CheckIcon size={36} strokeWidth={2.8} />
          </span>
        </span>
        <span className="mt-2 text-[15px] font-semibold text-frenz-muted">Sent</span>
        <CoinAmount cents={sent.amountCents} className="text-[44px] font-extrabold leading-none tracking-[-1.5px] text-frenz-ink" />
        <span className="text-[15px] text-frenz-muted">to {sent.to.name}</span>
        {sent.duplicate ? <span className="mt-1 text-[13px] font-semibold text-frenz-violet">This transfer had already gone through — it was sent once, not twice.</span> : null}
      </div>
      <DetailList
        className="mt-6"
        rows={[
          ["Status", <StatusBadge key="s" status="completed" />],
          ["Date", dateTimeLabel(sent.at)],
          ["To", sent.to.handle ? `${sent.to.name} · @${sent.to.handle}` : sent.to.name],
          ["Wallet number", walletNumber(sent.to.number)],
          ...(sent.note ? ([["Note", sent.note]] as [string, string][]) : []),
          ["Fee", `${fc(sent.feeCents)}`],
        ]}
        total={["Total debited", `${fc(sent.totalCents)}`]}
      />
      <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-dashed border-frenz-line px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-frenz-muted">Reference</span>
          <span className="truncate font-mono text-[13px] text-frenz-ink">{sent.transferId}</span>
        </span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(sent.transferId).then(() => setCopied(true), () => undefined)}
          aria-label={copied ? "Reference copied" : "Copy reference"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-frenz-fill text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue"
        >
          {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
        </button>
      </div>
      <ActionBar>
        <Link href="/wallet" prefetch={false} className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-frenz-gradient-x font-heading text-base font-bold text-white outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-frenz-blue focus-visible:ring-offset-2 motion-reduce:transition-none">
          <TapPending>{null}</TapPending>
          Done
        </Link>
      </ActionBar>
    </WalletScreen>
  );
}

/**
 * /wallet/transfer (design: Transfer → TransferReview → Receipt). Find the recipient by wallet number (on submit, never
 * per keystroke), type the amount, then Review: the SERVER prices it (/api/coin/quote) and the member confirms with their
 * PIN. One idempotency key per reviewed transfer, reused on every retry of it — a double tap or a lost response can only
 * ever send it once. The receipt shows what the server says it did. The draft (recipient, amount, note — never the PIN)
 * survives leaving and coming back (useStickyState), and is cleared once the transfer is confirmed.
 */
export function WalletTransfer({ summary, preset = null }: { summary: WalletSummary; preset?: Recipient | null }) {
  const router = useRouter();
  // a chat's "Send Frenz Coin" arrives with the person chosen (a different preset starts a fresh draft)
  const draft = preset?.number ?? 0;
  const [number, setNumber] = useStickyState("wallet-transfer-number", draft, preset?.number ?? "");
  const [recipient, setRecipient] = useStickyState<Recipient | null>("wallet-transfer-recipient", draft, preset);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<Fail | null>(null);
  const [raw, setRaw] = useStickyState("wallet-transfer-amount", draft, "");
  const [note, setNote] = useStickyState("wallet-transfer-note", draft, "");
  const [touched, setTouched] = useState(false);
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<Fail | null>(null);
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Fail | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const key = useRef<{ sig: string; key: string } | null>(null);
  const latest = useLatestRequest();

  const gate = transferGate(summary);
  if (sent) return <TransferReceipt sent={sent} />;
  if (!gate.open)
    return (
      <WalletScreen label="Transfer">
        <SubHeader title="Transfer" />
        <Unavailable title={gate.title} action={gate.action}>
          {gate.message}
        </Unavailable>
      </WalletScreen>
    );

  const t = summary.transfers;
  const cents = parseCoinInput(raw);
  const problem = amountProblem(cents, t, summary.availableCents);
  const noteValue = note.trim() || null;

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    const digits = walletDigits(number);
    if (digits.length !== 10) return setFindError({ msg: "Enter a 10-digit wallet number.", expired: false });
    if (finding) return;
    setFinding(true);
    setFindError(null);
    const r = await latest((signal) => walletApi.lookup(digits, signal));
    if (!r) return;
    setFinding(false);
    if (!r.ok) return setFindError({ msg: r.error, expired: r.session === "expired" });
    setRecipient({ number: digits, name: r.data.name, handle: r.data.handle, avatarUrl: r.data.avatarUrl });
  };

  const review = async () => {
    setTouched(true);
    if (!recipient || problem || cents == null || quoting) return;
    setQuoting(true);
    setQuoteError(null);
    const r = await latest((signal) => walletApi.quote("transfer", cents, signal));
    if (!r) return;
    setQuoting(false);
    if (!r.ok || r.data.kind !== "transfer") return setQuoteError({ msg: r.ok ? "Couldn't price this transfer." : failMessage(r, "transfer"), expired: !r.ok && r.session === "expired" });
    const sig = `${recipient.number}:${cents}:${noteValue ?? ""}`;
    if (!key.current || key.current.sig !== sig) key.current = { sig, key: newKey("cxf") };
    setPin("");
    setSendError(null);
    setQuote(r.data);
  };

  const confirm = async () => {
    if (!recipient || !quote || !key.current || sending || pin.length !== 6) return;
    setSending(true);
    setSendError(null);
    const r = await walletApi.transfer({ accountNumber: recipient.number, amountCents: quote.amountCents, idempotencyKey: key.current.key, note: noteValue, pin });
    setSending(false);
    setPin("");
    if (!r.ok) return setSendError({ msg: failMessage(r, "transfer"), expired: r.session === "expired" });
    setQuote(null);
    setSent({ ...r.data, at: new Date().toISOString(), to: recipient, note: noteValue });
    // the draft is spent; the balances everywhere are now stale — one refresh drops the router cache
    setNumber("");
    setRecipient(null);
    setRaw("");
    setNote("");
    key.current = null;
    invalidateCoinGlance();
    router.refresh();
  };

  const short = quote ? quote.totalCents > summary.availableCents : false;

  return (
    <WalletScreen label="Transfer">
      <SubHeader title="Transfer" />

      {recipient ? (
        <section aria-label="Recipient" className="mx-4 mt-4 flex items-center gap-3 rounded-[22px] border border-frenz-line px-3.5 py-3">
          <span className="rounded-full bg-frenz-gradient p-[2px]">
            <Avatar src={recipient.avatarUrl} name={recipient.name} size={44} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-semibold text-frenz-muted">Sending to</span>
            <span className="truncate text-[15px] font-bold text-frenz-ink">{recipient.name}</span>
            <span className="truncate text-[12.5px] text-frenz-muted">
              {recipient.handle ? `@${recipient.handle} · ` : ""}
              {walletNumber(recipient.number)}
            </span>
          </span>
          <button type="button" onClick={() => setRecipient(null)} className="h-9 rounded-full bg-frenz-fill px-3.5 text-[13px] font-bold text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
            Change
          </button>
        </section>
      ) : (
        <form onSubmit={(e) => void find(e)} className="mx-4 mt-4 flex flex-col gap-2">
          <label htmlFor="transfer-number" className="text-[13px] font-semibold text-frenz-muted">
            Recipient&apos;s wallet number
          </label>
          <div className="flex gap-2">
            <span className="flex h-12 flex-1 items-center gap-2 rounded-2xl bg-frenz-fill px-3.5 focus-within:ring-2 focus-within:ring-frenz-blue">
              <SearchIcon size={18} className="text-frenz-muted" />
              <input
                id="transfer-number"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000 000 0000"
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^\d\s]/g, "").slice(0, 14))}
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold tracking-[0.04em] text-frenz-ink outline-none placeholder:text-frenz-muted"
                aria-describedby={findError ? "transfer-number-error" : undefined}
              />
            </span>
            <button type="submit" disabled={finding} aria-busy={finding} className="h-12 shrink-0 rounded-2xl bg-frenz-ink px-4 text-sm font-bold text-frenz-page outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue focus-visible:ring-offset-2 disabled:opacity-60">
              {finding ? "Finding…" : "Find"}
            </button>
          </div>
          {findError ? (
            findError.expired ? (
              <SessionExpired next="/wallet/transfer" />
            ) : (
              <p id="transfer-number-error" role="alert" className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">
                {findError.msg}
              </p>
            )
          ) : (
            <p className="text-[12.5px] text-frenz-muted">Ask them for the number on their Wallet screen. You&apos;ll see their name before anything is sent.</p>
          )}
        </form>
      )}

      <div className="mt-8">
        <AmountEntry id="transfer-amount" label="Amount" value={raw} onChange={setRaw} hint={`${fc(summary.availableCents)} available`} />
      </div>
      {touched && problem ? (
        <p role="alert" className="mx-5 mt-2 text-center text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {problem}
        </p>
      ) : null}
      {touched && !recipient ? (
        <p role="alert" className="mx-5 mt-2 text-center text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          Find who you&apos;re sending to first.
        </p>
      ) : null}

      <label htmlFor="transfer-note" className="mx-4 mt-6 flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-frenz-muted">Note (optional)</span>
        <input id="transfer-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for?" className="h-12 rounded-2xl bg-frenz-fill px-3.5 text-[15px] text-frenz-ink outline-none placeholder:text-frenz-muted focus-visible:ring-2 focus-visible:ring-frenz-blue" />
      </label>

      <Notice tone="info" className="mt-4">
        {transferFeeNotice(summary.transfers.fee)}
      </Notice>

      {quoteError ? <div className="mt-3">{quoteError.expired ? <SessionExpired next="/wallet/transfer" /> : <Notice tone="error">{quoteError.msg}</Notice>}</div> : null}

      <ActionBar>
        <PillButton onClick={() => void review()} disabled={quoting} aria-busy={quoting}>
          {quoting ? "Working out the fee…" : "Review transfer"}
        </PillButton>
      </ActionBar>

      <GlassSheetShell open={!!quote} onClose={() => (sending ? undefined : setQuote(null))} title="Review transfer" fitContent defaultHeightVh={88}>
        {quote && recipient ? (
          <form
            className="frenz-ui flex flex-col gap-4 px-1 pb-8 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="rounded-full bg-frenz-gradient p-[2px]">
                <Avatar src={recipient.avatarUrl} name={recipient.name} size={52} />
              </span>
              <span className="mt-1 text-sm text-frenz-muted">You&apos;re sending {recipient.name}</span>
              <CoinAmount cents={quote.amountCents} className="text-[40px] font-extrabold leading-tight tracking-[-1.5px] text-frenz-ink" />
            </div>
            <DetailList
              className="mx-0"
              rows={[
                ["To", recipient.handle ? `@${recipient.handle}` : recipient.name],
                ["Wallet number", walletNumber(recipient.number)],
                ...(noteValue ? ([["Note", noteValue]] as [string, string][]) : []),
                ["They receive", `${fc(quote.amountCents)}`],
                ["Fee", `${fc(quote.feeCents)}`],
                ["Wallet after", short ? "—" : `${fc(summary.availableCents - quote.totalCents)}`],
              ]}
              total={["Total", `${fc(quote.totalCents)}`]}
            />
            {short ? (
              <Notice tone="error" className="mx-0">
                Your available balance doesn&apos;t cover the amount plus the fee. Send a smaller amount.
              </Notice>
            ) : (
              <p className="flex items-start gap-2 text-[12.5px] text-frenz-muted">
                <InfoIcon size={16} className="mt-px shrink-0" /> Transfers can&apos;t be reversed once sent. Check the name and number.
              </p>
            )}
            <PinField id="transfer-pin" label="Your 6-digit transaction PIN" value={pin} onChange={setPin} autoFocus disabled={sending || short} />
            {sendError ? sendError.expired ? <SessionExpired next="/wallet/transfer" /> : <Notice tone="error" className="mx-0">{sendError.msg}</Notice> : null}
            <PillButton type="submit" tone="ink" disabled={sending || short || pin.length !== 6} aria-busy={sending}>
              <LockIcon size={17} />
              {sending ? "Sending…" : `Confirm and send ${fc(quote.amountCents)}`}
            </PillButton>
          </form>
        ) : null}
      </GlassSheetShell>
    </WalletScreen>
  );
}
