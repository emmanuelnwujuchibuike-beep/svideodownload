"use client";

import { useEffect, useRef, useState } from "react";

import { useStickyState } from "@/features/ui/use-sticky-state";

import { type WalletSummary, walletApi } from "./api";
import { coins, fc, holdLabel, newKey, parseCoinInput } from "./money";
import { amountProblem, depositGate, failMessage } from "./state";
import { ClockIcon, LockIcon } from "./wallet-icons";
import { ActionBar, AmountEntry, DetailList, Notice, PillButton, SectionTitle, SessionExpired, SubHeader, Unavailable, WalletScreen } from "./wallet-ui";

const QUICK = [1000, 2500, 5000, 10000];

/**
 * /wallet/deposit (design: Deposit). The member picks an amount; the server records the attempt and hands back the
 * Flutterwave checkout. Nothing is credited here — the payment is verified by the server when they come back (and by the
 * webhook regardless), then the coins sit on hold for the published hold period. No card fee, no markup: 1 FC = $1.
 */
export function WalletDeposit({ summary }: { summary: WalletSummary }) {
  const [raw, setRaw] = useStickyState("wallet-deposit-amount", 0, "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; expired: boolean } | null>(null);
  const [touched, setTouched] = useState(false);
  // one key per amount: a double tap or a retry of the same amount is the same deposit attempt
  const key = useRef<{ cents: number; key: string } | null>(null);

  // back from the checkout via the browser's back button: the page comes out of the back-forward cache as it was left,
  // "Opening checkout…" included — let the member act again (the same key makes a second tap the same attempt)
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const gate = depositGate(summary);
  if (!gate.open)
    return (
      <WalletScreen label="Deposit">
        <SubHeader title="Deposit" />
        <Unavailable title={gate.title}>{gate.message}</Unavailable>
      </WalletScreen>
    );

  const d = summary.deposits;
  const cents = parseCoinInput(raw);
  const problem = amountProblem(cents, d);
  const quick = QUICK.filter((q) => q >= d.minCents && q <= d.maxCents);
  const hold = holdLabel(d.holdHours);

  const start = async () => {
    setTouched(true);
    if (problem || cents == null || busy) return;
    if (!key.current || key.current.cents !== cents) key.current = { cents, key: newKey("dep") };
    setBusy(true);
    setError(null);
    const r = await walletApi.deposit({ amountCents: cents, idempotencyKey: key.current.key });
    if (!r.ok) {
      setBusy(false);
      return setError({ msg: failMessage(r, "deposit"), expired: r.session === "expired" });
    }
    // to the provider's checkout; on return the wallet asks the server what actually happened
    window.location.assign(r.data.url);
  };

  return (
    <WalletScreen label="Deposit">
      <SubHeader title="Deposit" />

      <section className="mx-4 mt-4 flex flex-col gap-4 rounded-[30px] px-5 pb-5 pt-6 text-white" style={{ background: "radial-gradient(90% 80% at 100% 0%, hsl(var(--frenz-magenta) / 0.55) 0%, hsl(var(--frenz-magenta) / 0) 60%), radial-gradient(90% 80% at 0% 100%, hsl(var(--frenz-blue) / 0.8) 0%, hsl(var(--frenz-blue) / 0) 62%), hsl(247 21% 8%)" }}>
        <AmountEntry id="deposit-amount" label="Amount to add" value={raw} onChange={setRaw} dark hint={cents ? `You pay $${coins(cents)} USD` : `Between ${fc(d.minCents)} and ${fc(d.maxCents)}`} disabled={busy} />
        {quick.length ? (
          <div className="flex flex-wrap justify-center gap-2" aria-label="Quick amounts">
            {quick.map((q) => (
              <button key={q} type="button" disabled={busy} onClick={() => setRaw(String(q / 100))} aria-pressed={cents === q} className="h-9 rounded-full border border-white/20 bg-white/10 px-4 text-[13px] font-bold outline-none backdrop-blur-md focus-visible:ring-2 focus-visible:ring-white aria-pressed:bg-white aria-pressed:text-frenz-ink">
                {coins(q)}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {touched && problem ? (
        <p role="alert" className="mx-5 mt-3 text-[13px] font-semibold text-rose-700 dark:text-rose-300">
          {problem}
        </p>
      ) : null}

      <SectionTitle>Summary</SectionTitle>
      <DetailList
        rows={[
          ["You get", cents ? `${fc(cents)}` : "—"],
          ["Rate", "1 FC = $1.00"],
          ["Deposit fee", "None"],
          ["Spendable", hold ? `After a ${hold} hold` : "Right away"],
        ]}
        total={["You pay", cents ? `$${coins(cents)}` : "—"]}
      />

      {hold ? (
        <Notice tone="info" title="Why the short hold?" className="mt-4">
          New deposits show in your wallet straight away but stay on hold for {hold} before you can send or withdraw them. It protects you and other members from reversed payments.
        </Notice>
      ) : null}

      {error ? <div className="mt-3">{error.expired ? <SessionExpired next="/wallet/deposit" /> : <Notice tone="error">{error.msg}</Notice>}</div> : null}

      <ActionBar
        hint={
          <>
            <LockIcon size={13} /> Paid securely through Flutterwave. You&apos;ll come back here when it&apos;s done.
          </>
        }
      >
        <PillButton onClick={() => void start()} disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <ClockIcon size={18} /> Opening checkout…
            </>
          ) : cents && !problem ? (
            `Continue to pay $${coins(cents)}`
          ) : (
            "Continue to payment"
          )}
        </PillButton>
      </ActionBar>
    </WalletScreen>
  );
}
