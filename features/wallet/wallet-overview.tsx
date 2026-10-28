"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useStickyState } from "@/features/ui/use-sticky-state";
import { cn } from "@/lib/utils";

import { ActivityList } from "./activity";
import { CoinAmount } from "./coin-amount";
import { type HistoryPage, type WalletSummary, walletApi } from "./api";
import { coins, dateTimeLabel, fc, holdLabel, releaseLabel, walletNumber } from "./money";
import { depositVerifyView } from "./state";
import { invalidateCoinGlance } from "./coin-glance";
import { TapPending } from "./tap-pending";
import { useRefreshOnLongReturn, whenVisible } from "./use-wallet-runtime";
import { BankIcon, CheckIcon, ClockIcon, CopyIcon, DepositIcon, EyeIcon, EyeOffIcon, LockIcon, SendIcon, SettingsIcon, ShieldCheckIcon } from "./wallet-icons";
import { CoinMark, HeroCard, Notice, SectionTitle, Unavailable, WalletScreen } from "./wallet-ui";

type VerifyState = "on_hold" | "pending" | "failed" | "review" | "not_found" | "error";

/**
 * Back from the Flutterwave checkout (`/wallet?deposit=<ref>`): ask the SERVER about that one reference — the redirect
 * itself proves nothing. Two quiet follow-ups while it is still "pending" (5 s, then 15 s — and only while the page is
 * visible), then only on tap. Once the answer is final the `?deposit=` is dropped from the address (replaceState, no
 * navigation), so a back-swipe or a reload never checks it again. Leaving the page aborts everything.
 */
function DepositReturn({ reference }: { reference: string }) {
  const router = useRouter();
  const [state, setState] = useState<VerifyState | "checking">("checking");
  const [detail, setDetail] = useState<{ amountCents?: number; releaseAt?: string }>({});
  const tries = useRef(0);
  const life = useRef<AbortController | null>(null);

  const check = async () => {
    const signal = life.current?.signal;
    if (!signal || signal.aborted) return;
    setState("checking");
    const r = await walletApi.verifyDeposit(reference, signal);
    if (signal.aborted) return;
    tries.current += 1;
    let next: VerifyState;
    if (r.ok) {
      next = r.data.status;
      setDetail({ amountCents: r.data.amountCents, releaseAt: r.data.releaseAt });
    } else next = r.status === 404 || r.status === 400 ? "not_found" : "error";
    setState(next);
    if (depositVerifyView(next).final) {
      try {
        window.history.replaceState(window.history.state, "", "/wallet");
      } catch {
        /* the address keeps the reference; a later check answers the same */
      }
    }
    if (next === "on_hold") {
      invalidateCoinGlance();
      router.refresh();
    }
    if (next === "pending" && tries.current < 3) {
      const wait = tries.current === 1 ? 5_000 : 15_000;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait);
        signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
      if (await whenVisible(signal)) void check();
    }
  };

  useEffect(() => {
    life.current = new AbortController();
    void check();
    return () => life.current?.abort();
    // once per reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  if (state === "checking")
    return (
      <Notice tone="info" title="Checking your payment…" className="mt-4">
        Confirming with the payment provider. This takes a few seconds.
      </Notice>
    );
  const v = depositVerifyView(state);
  return (
    <Notice
      tone={v.tone}
      title={v.title}
      className="mt-4"
      action={
        !v.final ? (
          <button type="button" onClick={() => void check()} className="self-start font-bold underline underline-offset-4">
            Check again
          </button>
        ) : state === "failed" ? (
          <Link href="/wallet/deposit" className="flex min-h-11 touch-manipulation items-center gap-1.5 self-start font-bold underline underline-offset-4 active:opacity-60">
            Try again
            <TapPending size={14}>{null}</TapPending>
          </Link>
        ) : null
      }
    >
      {v.message}
      {state === "on_hold" && detail.amountCents ? ` ${fc(detail.amountCents)}${detail.releaseAt ? `, spendable ${dateTimeLabel(detail.releaseAt)}` : ""}.` : null}
    </Notice>
  );
}

function ActionButton({ href, label, primary, children, disabled }: { href: string; label: string; primary?: boolean; children: React.ReactNode; disabled?: boolean }) {
  const circle = cn("flex h-14 w-14 items-center justify-center rounded-full transition motion-reduce:transition-none", primary ? "bg-white text-frenz-ink shadow-[0_10px_22px_-10px_rgb(0_0_0/0.6)]" : "border border-white/20 bg-white/10 text-white backdrop-blur-md");
  if (disabled)
    return (
      <span aria-disabled className="flex flex-col items-center gap-1.5 opacity-45">
        <span className={circle}>{children}</span>
        <span className="text-[12.5px] font-semibold text-white/90">{label}</span>
      </span>
    );
  return (
    // a main button (Deposit / Withdraw / Transfer): prefetched like the other main buttons, and it spins from the tap (owner, 2026-10-27)
    <Link href={href} className="group flex touch-manipulation flex-col items-center gap-1.5 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/80">
      <span className={cn(circle, "group-active:scale-90")}>
        <TapPending size={20}>{children}</TapPending>
      </span>
      <span className="text-[12.5px] font-semibold text-white/90">{label}</span>
    </Link>
  );
}

/**
 * /wallet — the Frenz Coin wallet (design: Main). Everything shown is the server's: balances, holds, the wallet number,
 * what is allowed. Disabled → a plain "not available" panel and no money controls.
 */
export function WalletOverview({ summary, history, depositRef, loadedAt }: { summary: WalletSummary; history: HistoryPage | null; depositRef: string | null; loadedAt: number }) {
  // opens as the member chose in Wallet settings; the eye still toggles for this visit
  const [hidden, setHidden] = useStickyState<boolean>("frenz-coin-hide-balance", 0, summary.hideBalance);
  const [copied, setCopied] = useState(false);
  useRefreshOnLongReturn();

  if (!summary.enabled)
    return (
      <WalletScreen label="Frenz Coin wallet">
        <header className="px-5 pt-4">
          <h1 className="font-heading text-[32px] font-extrabold tracking-[-1px] text-frenz-ink">Wallet</h1>
        </header>
        <Unavailable title="Frenz Coin isn't available yet">The Frenz Coin wallet isn&apos;t switched on right now. Nothing has been charged and there&apos;s nothing you need to do.</Unavailable>
      </WalletScreen>
    );

  const pinSet = summary.transfers.pin.set;
  const mask = "••••";
  const copy = () => {
    if (!summary.walletNumber) return;
    void navigator.clipboard?.writeText(summary.walletNumber).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };

  return (
    <WalletScreen label="Frenz Coin wallet">
      <header className="flex items-center justify-between px-5 pb-3 pt-4">
        <h1 className="font-heading text-[32px] font-extrabold tracking-[-1px] text-frenz-ink">Wallet</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label={hidden ? "Show balance" : "Hide balance"} className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-frenz-fill text-frenz-ink outline-none transition active:scale-90 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none">
            {hidden ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          </button>
          {/* Wallet settings (owner, 2026-10-26: "there is no users wallet settings to change pin, and notification settings"):
              PIN first, then notifications, privacy, saved banks and recipients. The key icon led to the PIN alone and was not found. */}
          <Link href="/wallet/settings" prefetch={false} aria-label="Wallet settings" title="Wallet settings" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-frenz-fill text-frenz-ink outline-none transition active:scale-90 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none">
            <TapPending>
              <SettingsIcon size={20} />
            </TapPending>
          </Link>
        </div>
      </header>

      <HeroCard label="Balance">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CoinMark />
            <span className="font-heading text-[15px] font-bold">Frenz Coin</span>
          </span>
          {pinSet ? (
            <span className="flex h-7 items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 text-xs font-semibold">
              <ShieldCheckIcon size={14} /> PIN protected
            </span>
          ) : (
            <Link href="/wallet/security" prefetch={false} className="flex h-7 touch-manipulation items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2.5 text-xs font-semibold outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none">
              <TapPending size={13}>
                <LockIcon size={13} />
              </TapPending>{" "}
              Set a PIN
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-white/70">Available balance</span>
          <span className="flex items-baseline gap-2 font-heading font-extrabold tracking-[-1.5px]" aria-live="polite">
            {hidden ? (
              <span className="text-[46px] leading-none">
                <span className="mr-[0.12em] align-top text-[0.5em]">FC</span>
                {mask}
                <span className="sr-only">Balance hidden</span>
              </span>
            ) : (
              <CoinAmount cents={summary.availableCents} className="text-[46px] leading-none" />
            )}
          </span>
          <span className="text-[13px] font-semibold text-white/70">{hidden ? "≈ $••••" : `≈ $${coins(summary.availableCents)} USD`}</span>
        </div>

        <div className="flex items-end justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55">Wallet number</span>
            <span className="font-heading text-[15px] font-bold tracking-[0.06em]">{summary.walletNumber ? walletNumber(summary.walletNumber) : "Not assigned yet"}</span>
          </span>
          {summary.walletNumber ? (
            <button type="button" onClick={copy} aria-label={copied ? "Wallet number copied" : "Copy wallet number"} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white">
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>

        <nav aria-label="Wallet actions" className="grid grid-cols-3 gap-2 rounded-[24px] border border-white/10 bg-white/[0.06] px-2 py-3 backdrop-blur-md">
          <ActionButton href="/wallet/deposit" label="Deposit" primary disabled={!summary.deposits.enabled}>
            <DepositIcon size={22} />
          </ActionButton>
          <ActionButton href="/wallet/withdraw" label="Withdraw" disabled={!summary.withdrawals.enabled}>
            <BankIcon size={21} />
          </ActionButton>
          <ActionButton href="/wallet/transfer" label="Transfer" disabled={!summary.transfers.enabled}>
            <SendIcon size={20} />
          </ActionButton>
        </nav>
      </HeroCard>

      {depositRef ? <DepositReturn reference={depositRef} /> : null}

      {/* the design's In/Out tiles, as the two figures the server actually keeps: deposits on hold, coins held for withdrawals */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-[22px] bg-frenz-fill/70 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-frenz-muted">
            <ClockIcon size={15} /> On hold
          </span>
          <span className="font-heading text-lg font-extrabold text-frenz-ink">{hidden ? mask : `${fc(summary.pendingCents)}`}</span>
          <span className="text-[11.5px] text-frenz-muted">{summary.nextReleaseAt ? `Next release ${releaseLabel(summary.nextReleaseAt)}` : holdLabel(summary.deposits.holdHours) ? `New deposits wait ${holdLabel(summary.deposits.holdHours)}` : "New deposits are ready at once"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-[22px] bg-frenz-fill/70 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-frenz-muted">
            <BankIcon size={15} /> Held
          </span>
          <span className="font-heading text-lg font-extrabold text-frenz-ink">{hidden ? mask : `${fc(summary.heldCents)}`}</span>
          <span className="text-[11.5px] text-frenz-muted">For withdrawals in progress</span>
        </div>
      </div>

      {summary.pendingDeposits.length > 0 ? (
        <>
          <SectionTitle>Deposits on hold</SectionTitle>
          <ul className="mx-4 flex flex-col rounded-[22px] border border-frenz-line px-4">
            {summary.pendingDeposits.map((d, i) => (
              <li key={`${d.settledAt}-${i}`} className={cn("flex items-center justify-between gap-3 py-3 text-sm", i > 0 && "border-t border-frenz-line")}>
                <span className="flex flex-col">
                  <span className="font-semibold text-frenz-ink">{hidden ? mask : `${fc(d.amountCents)}`}</span>
                  <span className="text-[12.5px] text-frenz-muted">{d.status === "disputed" ? "Held while a payment question is resolved" : `Spendable ${releaseLabel(d.releaseAt)} · ${dateTimeLabel(d.releaseAt)}`}</span>
                </span>
                <span className="inline-flex h-[18px] items-center rounded-full bg-amber-100 px-[7px] text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{d.status === "disputed" ? "Held" : "On hold"}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* Frenz Gift Coin Part 5: the Gift Box — received and sent sticker gifts, gift earnings, and converting them to Frenz Coins */}
      {/* a main button: prefetched, and it spins from the tap until the Gift Box opens (owner, 2026-10-27) */}
      <Link href="/wallet/gifts" className="mx-4 mt-4 flex min-h-11 touch-manipulation items-center justify-between rounded-[22px] border border-white bg-white/80 px-4 py-3 text-sm font-bold text-frenz-ink shadow-frenz-card outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-blue">
        <span>Gift Box</span>
        <span className="flex items-center gap-1.5 text-frenz-violet">
          <TapPending size={16}>Gift Coins &amp; gifts ›</TapPending>
        </span>
      </Link>
      <SectionTitle
        action={
          <Link href="/wallet/activity" prefetch={false} className="flex min-h-11 touch-manipulation items-center gap-1.5 text-sm font-bold text-frenz-violet outline-none transition active:opacity-60 focus-visible:underline">
            See all
            <TapPending size={14}>{null}</TapPending>
          </Link>
        }
      >
        Activity
      </SectionTitle>
      {history ? <ActivityList initial={history.items} initialNext={history.next} loadedAt={loadedAt} limit={8} /> : <Notice tone="error">Couldn&apos;t load your activity. Pull down to try again.</Notice>}
    </WalletScreen>
  );
}
