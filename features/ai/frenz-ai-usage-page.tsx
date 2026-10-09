"use client";

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ChevronRight, Eye, EyeOff, Plus, RotateCcw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { refreshWallet, useWallet } from "@/features/ai/wallet/use-wallet";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CharacterReplaceRechargeSheet } from "@/features/ai/character-replace/recharge-sheet";
import { AiCreditsCard } from "@/features/ai/credits/ai-credits-card";
import type { PlanCelebrationProps } from "@/features/ai/credits/plan-celebration";
import { TransferPanel } from "@/features/ai/wallet/transfer-panel";
import { formatKind, KIND_NAME, KindSymbol, type WalletKind } from "@/features/ai/wallet/wallet-kinds";
import { getAiCredits, takeAiPlanReturn, verifyAiPlanReturn } from "@/lib/ai/credits/client";
import { AI_CREDIT_FEATURES, AI_FEATURE_LABELS } from "@/lib/ai/credits/features";
import { StatementDetailSheet } from "@/features/ai/statement-detail-sheet";
import { HIDDEN_AMOUNT, useBalanceHidden } from "@/lib/ai/character-replace/balance-privacy";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { aiButtonClass } from "@/features/ai/design/ai-button";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiToolTitle } from "@/features/ai/design/ai-surface";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { takeTopupReturnReference, verifyCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import { formatCredits, formatLedgerAmount, WALLET_UNIT } from "@/lib/ai/credits/units";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Frenz AI — Balance & usage (rebuilt 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "Add balance from the usage page goes back to the AI welcome page —
 * make the balance page look more professional and premium without costing
 * the performance."
 *
 * What changed:
 *   · "Recharge" opens the SAME recharge sheet the workspace uses, in place;
 *     the Paystack return lands back on this page and is verified here, so a
 *     member who came to top up never leaves the page to do it.
 *   · One hero: the balance, what a second costs, Recharge, Create a video.
 *   · Three honest figures from the statement itself — videos made, spent,
 *     refunded — labelled for the lines this page holds, never a guess.
 *   · Character Replace only (owner, 2026-09-20): the retired AI Clean allowance
 *     meters are gone — this page is the wallet and its statement.
 *   · The statement rows carry a glyph per kind and a real sentence.
 *
 * Performance: the page is what it was — one client component, one request
 * for the balance + 100 ledger lines (`/api/ai/character-replace/balance`),
 * and the sheet's chunk is fetched only when Recharge is pressed (next/dynamic
 * inside the sheet module).
 */
type LedgerKind = "recharge" | "processing_charge" | "refund" | "adjustment" | "reversal" | "bonus" | "grant" | "withdrawal" | "withdrawal_reversal" | "transfer_out" | "transfer_in" | "transfer_fee";

type LedgerRow = CharacterReplaceTransaction;

const LEDGER_COPY: Record<LedgerKind, { label: string; Icon: typeof Sparkles; tone: "in" | "out" | "neutral" }> = {
  recharge: { label: "Credits added", Icon: ArrowDownLeft, tone: "in" },
  // 0184: a pack's bonus credits, and credits the product gives
  bonus: { label: "Bonus credits", Icon: Sparkles, tone: "in" },
  grant: { label: "Credits earned", Icon: Sparkles, tone: "in" },
  // 0187: cashing out withdrawable reward credits, and a withdrawal that was returned
  withdrawal: { label: "Withdrawal", Icon: ArrowDownLeft, tone: "out" },
  withdrawal_reversal: { label: "Withdrawal returned", Icon: RotateCcw, tone: "in" },
  // 0193: credits sent to / received from another member's wallet, and the 5% fee
  transfer_out: { label: "Credits sent", Icon: ArrowUpRight, tone: "out" },
  transfer_in: { label: "Credits received", Icon: ArrowDownLeft, tone: "in" },
  transfer_fee: { label: "Transfer fee", Icon: ArrowUpRight, tone: "out" },
  // 2026-10-06: the one AI wallet pays for every tool now — Character Replace is retired
  processing_charge: { label: "Frenz AI creation", Icon: Sparkles, tone: "out" },
  refund: { label: "Refunded — the video didn't finish", Icon: RotateCcw, tone: "in" },
  adjustment: { label: "Adjustment by Frenz", Icon: ShieldCheck, tone: "neutral" },
  reversal: { label: "Reversed", Icon: RotateCcw, tone: "neutral" },
};

// 2026-10-07 (owner): the subscription celebration + optional survey — its chunk loads only when there is a plan to celebrate
const PlanCelebration = dynamic(() => import("@/features/ai/credits/plan-celebration").then((m) => m.PlanCelebration), { ssr: false });

/** The welcome push opens `?plan_welcome=1` (lib/ai/credits/plan-welcome.ts) — taken once and removed from the address. */
/** An AI plan's celebration: its allowance as the headline, every Frenz AI tool as the benefits. */
function aiCelebration(plan: "ai_pro" | "ai_max", planLabel: string, daily: number, weekly: number): Omit<PlanCelebrationProps, "onClose"> {
  return { plan, family: "ai", planLabel, subtitle: `Your plan is active — ${daily} credits a day, ${weekly} a week.`, benefits: AI_CREDIT_FEATURES.map((id) => AI_FEATURE_LABELS[id]) };
}

function takePlanWelcome(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("plan_welcome")) return false;
  params.delete("plan_welcome");
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  return true;
}

export function FrenzAIUsagePage({
  aiHref = "/ai",
  createHref = "/studio/ai/character-replace",
  slides = [],
}: {
  aiHref?: string;
  createHref?: string;
  slides?: ShowcaseSlide[];
}) {
  /* 2026-09-20: a tap on the figure hides it (kept per browser); a tap on a line opens it in full */
  const [hidden, toggleHidden] = useBalanceHidden();
  const [openLine, setOpenLine] = useState<LedgerRow | null>(null);
  /*
    🔴 NEVER A RELOAD ON ENTRY (owner, 2026-10-09: "the credit page and dashboard
    reload on every entry … it only supposed to revalidate and update instantly
    when a balance update. And never reload the page.")

    Balance + statement lived in component state that started at null, so every
    visit painted the skeleton and refetched. They now live in the shared client
    cache under one key per member: a return visit paints the last-known wallet
    in the first frame and does NOT refetch. It changes only when the balance
    does — the shared wallet-row realtime channel (useWallet), a top-up or plan
    return, a transfer — each of which forces a re-read of that key. A cold
    start (nothing cached yet) still loads once.
  */
  const wallet = useWallet();
  const balance = wallet.data?.balance ?? null;
  const ledger: LedgerRow[] | null = wallet.data?.transactions ?? null;
  const failed = !wallet.data && !!wallet.error;
  const [notice, setNotice] = useState<string | null>(null);
  // 0167: bumps re-read the AI allowance (after a plan return)
  const [creditsKey, setCreditsKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState<Omit<PlanCelebrationProps, "onClose"> | null>(null);
  const closeCelebration = useCallback(() => setCelebrate(null), []);

  const uid = wallet.uid;
  const load = useCallback(async () => {
    await refreshWallet(uid);
  }, [uid]);

  useEffect(() => {
    /*
      The return from Paystack, if this is one: the reference leaves the
      address bar first, is verified once, then the wallet is re-read — the
      same contract the workspace keeps, so a recharge started HERE finishes
      here, with the new balance on screen.
    */
    // 0167: the return from an AI plan checkout — verified by its reference on the server, never by the URL's word
    const planReturn = takeAiPlanReturn();
    const reference = planReturn ? null : takeTopupReturnReference();
    const welcome = takePlanWelcome();
    void (async () => {
      if (planReturn?.reference) {
        const verified = await verifyAiPlanReturn(planReturn.reference);
        setNotice(verified.ok ? (verified.activated ? `${verified.planLabel ?? "Your AI plan"} is active — ${verified.dailyLimit} credits a day, ${verified.weeklyLimit} a week.` : verified.status === "success" ? "Payment received — your plan will activate as soon as Paystack confirms it." : "Your payment wasn't completed. Nothing was charged.") : verified.error);
        if (verified.ok && verified.activated && verified.plan) {
          setCelebrate(aiCelebration(verified.plan, verified.planLabel ?? "your AI plan", verified.dailyLimit ?? 0, verified.weeklyLimit ?? 0));
        }
        setCreditsKey((k) => k + 1);
      } else if (welcome) {
        // opened from the welcome push: celebrate the plan the server says is active, never one the URL names
        const credits = await getAiCredits();
        const e = credits.ok ? credits.entitlement : null;
        if (e?.plan && e.subscription?.active) setCelebrate(aiCelebration(e.plan, e.planLabel ?? "your AI plan", e.dailyLimit, e.weeklyLimit));
      } else if (reference) {
        const verified = await verifyCharacterReplaceTopup(reference);
        setNotice(verified.ok ? (verified.credited ? "Payment received — your balance has been updated." : verified.pending ? "Your payment is still being confirmed. This will update shortly." : null) : null);
      }
      // Only a return from a payment is news. A plain entry paints the cached
      // wallet and fetches nothing (a cold cache is loaded by useQuery itself).
      if (planReturn || reference || welcome) await load();
    })();
  }, [load]);

  // 0193 (owner 2026-10-07: "when the account gets funded the credit balance updates instantly"):
  // the wallet-row realtime channel now lives in useWallet, shared with every screen showing the wallet.

  const openSheet = useCallback((amount: number | null = null) => {
    haptic("selection");
    setSuggested(amount);
    setSheetMounted(true);
    setSheetOpen(true);
  }, []);

  /* ── honest figures from the lines this page holds ─────────────────────── */
  const figures = useMemo(() => {
    if (!ledger) return null;
    let videos = 0;
    let spent = 0;
    let refunded = 0;
    for (const row of ledger) {
      if (row.kind === "processing_charge") videos += 1;
      // 🔴 0184: rows before the switch are dollars — only credit rows are summed, never mixed units
      if (row.currency !== WALLET_UNIT) continue;
      if (row.kind === "processing_charge") spent += -row.deltaCents;
      else if (row.kind === "refund") refunded += row.deltaCents;
    }
    return { videos, spent: Math.max(0, spent - refunded), refunded, partial: ledger.length >= 100 };
  }, [ledger]);

  /* ── Today / Yesterday / This week / Last week / Earlier — the product's one calendar ── */
  const sections = useMemo(() => {
    if (!ledger) return [];
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    const yesterday = today - 86_400_000;
    const week = today - 6 * 86_400_000;
    const lastWeek = today - 13 * 86_400_000;
    const buckets: { key: string; label: string; items: LedgerRow[] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "week", label: "This week", items: [] },
      { key: "lastweek", label: "Last week", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const row of ledger) {
      const t = Date.parse(row.createdAt);
      const at = Number.isFinite(t) ? t : 0;
      const i = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : at >= lastWeek ? 3 : 4;
      buckets[i]!.items.push(row);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [ledger]);

  const symbol = balance?.symbol ?? "₦";

  return (
    /*
      Redesign 2026-10-06 (page 10, Credit Balance): plain white like every
      redesigned AI page — no wash, no frame, no double gutter; the showcase on
      large screens only; the shared tool title. No credits strip: this page IS
      the balance.
    */
    <FrenzAIEnvironment stage="idle" bare className="relative">
      <div className="pb-10 pt-3">
        <AiShowcase slides={slides} base={aiHref} desktopOnly className="mb-5" />
        <AiToolTitle
          icon={Wallet}
          title="Credit Balance"
          tagline="What you have, and every line of it."
          body="Your AI balance, your plan's allowance, and each recharge, creation and refund."
        />

        {failed ? (
          <div className="mt-6 rounded-2xl bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
            <p className="text-[13.5px] text-muted-foreground">Couldn&apos;t load your balance right now.</p>
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                void load();
              }}
              className={aiButtonClass({ size: "sm", className: "mt-3" })}
            >
              Try again
            </button>
          </div>
        ) : null}

        {!balance && !failed ? <UsageSkeleton /> : null}

        {balance ? (
          <>
            {/* ── the hero: the balance, and the two things to do with it ── */}
            <section
              aria-label="Balance"
              className={cn(
                "relative mt-6 overflow-hidden rounded-[1.6rem] p-5 text-white sm:p-6",
                "bg-[linear-gradient(135deg,#1d4ed8_0%,#4f46e5_55%,#a21caf_100%)] shadow-[0_24px_48px_-28px_rgba(79,70,229,0.75)]",
              )}
            >
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">AI credits</p>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("selection");
                      toggleHidden();
                    }}
                    aria-pressed={hidden}
                    aria-label={hidden ? "Show balance" : "Hide balance"}
                    className="mt-1.5 block rounded-lg text-left text-[2.35rem] font-bold leading-none tracking-[-0.035em] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:text-[2.7rem]"
                  >
                    {hidden ? <span aria-hidden>{HIDDEN_AMOUNT}</span> : formatCredits(balance.balanceCents)}
                  </button>
                  <p className="mt-1 text-[11.5px] text-white/60">{hidden ? "Tap to show" : "Tap to hide"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    toggleHidden();
                  }}
                  aria-label={hidden ? "Show balance" : "Hide balance"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25 transition hover:bg-white/25"
                >
                  {hidden ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
              </div>
              {/* 0199 (owner, 2026-10-08): the two kinds apart — the total above is what every tool spends from */}
              {typeof balance.withdrawableCents === "number" ? (
                <dl aria-label="Your credits by kind" className="relative mt-4 grid grid-cols-2 gap-2">
                  {/* 2026-10-09 (owner): non-withdrawable = Tokens, withdrawable = Credits — same value, own name and symbol */}
                  <KindFigure kind="usable" hint="For Frenz AI tools" value={hidden ? HIDDEN_AMOUNT : formatKind(Math.max(0, balance.balanceCents - balance.withdrawableCents), "usable")} />
                  <KindFigure
                    kind="withdrawable"
                    hint={balance.depositedCents && !hidden ? `Can be cashed out · ${formatKind(balance.depositedCents, "withdrawable")} deposited` : "Can be cashed out"}
                    value={hidden ? HIDDEN_AMOUNT : formatKind(balance.withdrawableCents, "withdrawable")}
                  />
                </dl>
              ) : null}
              {notice ? (
                <p role="status" className="relative mt-3 rounded-xl bg-white/15 px-3 py-2 text-[12.5px] font-medium ring-1 ring-inset ring-white/20">
                  {notice}
                </p>
              ) : null}
              <div className="relative mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openSheet(null)}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-indigo-700 shadow-sm transition active:scale-[0.98] motion-safe:hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Top up credits
                </button>
                <Link
                  href={createHref}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white/90 ring-1 ring-inset ring-white/30 transition hover:bg-white/10"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Explore AI tools
                </Link>
              </div>
              {balance.offer.packs.length > 0 ? (
                <div className="relative mt-4 flex flex-wrap gap-1.5" aria-label="Quick credit packs">
                  {balance.offer.packs.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openSheet(p.credits)}
                      className="rounded-full bg-white/12 px-3 py-1.5 text-[12.5px] font-semibold tabular-nums text-white/90 ring-1 ring-inset ring-white/20 transition hover:bg-white/20"
                    >
                      + {formatCredits(p.credits)}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {/* ── 0167: the AI plan and its allowance — or the door to one ─────── */}
            <AiCreditsCard className="mt-4" refreshKey={creditsKey} returnTo="/studio/ai/usage" />

            {/* 2026-10-07 (owner brief §7, §11): rewards and referrals — AI Credits vs Withdrawable live on /rewards */}
            <TapOnceLink
              href="/rewards"
              spinner={false}
              className="mt-4 flex items-center gap-3 rounded-2xl transition-[transform,opacity] active:scale-[0.98] data-[pending]:scale-[0.98] data-[pending]:opacity-80 bg-card/95 px-4 py-3.5 ring-1 ring-inset ring-black/[0.05] transition hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:ring-white/10"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-500 text-white">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">Rewards &amp; referrals</span>
                <span className="block text-[12.5px] text-muted-foreground">Earn credits by creating, sharing and inviting friends.</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </TapOnceLink>

            {/* 0193 (owner 2026-10-07): send credits to a wallet number, and the transfer history */}
            <TransferPanel className="mt-4" rules={balance?.offer?.transfers ?? null} balance={balance?.balanceCents ?? null} withdrawable={balance?.withdrawableCents ?? null} deposited={balance?.depositedCents ?? null} onChanged={() => void load()} />

            {/* ── three figures, from the statement itself ─────────────────── */}
            {figures ? (
              <section aria-label="Your account at a glance" className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                <Figure label="Creations" value={String(figures.videos)} />
                <Figure label="Credits spent" value={hidden ? HIDDEN_AMOUNT : formatCredits(figures.spent, { short: true })} />
                <Figure label="Refunded" value={hidden ? HIDDEN_AMOUNT : formatCredits(figures.refunded, { short: true })} tone={figures.refunded > 0 ? "in" : undefined} />
              </section>
            ) : null}
            {figures?.partial ? <p className="mt-2 text-[11.5px] text-muted-foreground">Counted from your most recent 100 lines.</p> : null}

            {/* ── the statement ─────────────────────────────────────────── */}
            <section aria-label="Statement" className="mt-8">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[1.05rem] font-bold tracking-[-0.02em]">Statement</h2>
                <span className="text-[12px] text-muted-foreground">Newest first</span>
              </div>
              {sections.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-border/70 px-5 py-8 text-center">
                  <p className="text-sm font-semibold">Nothing here yet</p>
                  <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">Your first top-up, creation or refund will appear here.</p>
                </div>
              ) : (
                sections.map((section) => (
                  <div key={section.key} className="mt-4">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{section.label}</h3>
                    <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
                      {section.items.map((row) => {
                        const copy = LEDGER_COPY[row.kind] ?? LEDGER_COPY.adjustment;
                        const Icon = copy.Icon;
                        return (
                          <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => {
                              haptic("selection");
                              setOpenLine(row);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50 focus-visible:outline-none focus-visible:bg-secondary/60"
                            aria-label={`${copy.label}, ${formatLedgerAmount(row.deltaCents, row.currency)} — see the details`}
                          >
                            <span
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                copy.tone === "in" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : copy.tone === "out" ? "bg-secondary text-foreground/80" : "bg-secondary text-muted-foreground",
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-semibold">{copy.label}</p>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {formatDate(row.createdAt)} · {formatTime(row.createdAt)}
                                {row.note && row.kind === "adjustment" ? ` · ${row.note}` : ""}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className={cn("text-[14px] font-bold tabular-nums", row.deltaCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                                {formatLedgerAmount(row.deltaCents, row.currency, { signed: true })}
                              </p>
                              <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">{formatLedgerAmount(row.balanceAfterCents, row.currency)} after</p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                          </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
              {ledger && ledger.length >= 100 ? <p className="mt-3 text-[12px] text-muted-foreground">Showing your most recent 100 lines.</p> : null}
              <p className="mt-2 text-[12px] text-muted-foreground">Tap a line for its full details and ID — handy for a support request.</p>
            </section>
            <StatementDetailSheet row={openLine} symbol={symbol} onClose={() => setOpenLine(null)} />
          </>
        ) : null}
        {celebrate ? <PlanCelebration {...celebrate} onClose={closeCelebration} /> : null}

        <div className="mt-8">
          <TapOnceLink href={aiHref} className={aiButtonClass({ variant: "secondary", size: "sm", className: "ai-btn--round" })}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Frenz AI
          </TapOnceLink>
        </div>
      </div>

      {sheetMounted && balance ? (
        <CharacterReplaceRechargeSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          balance={balance}
          returnTo={typeof window !== "undefined" ? window.location.pathname : "/studio/ai/usage"}
          suggestedCredits={suggested}
        />
      ) : null}
    </FrenzAIEnvironment>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "in" }) {
  return (
    <div className="rounded-2xl bg-card/95 px-3 py-3 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:px-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-[17px] font-bold tabular-nums tracking-[-0.02em]", tone === "in" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
    </div>
  );
}


/** Shapes only — no numbers. */
function UsageSkeleton() {
  return (
    <div className="mt-6 space-y-4" aria-hidden>
      <div className="h-[11rem] animate-pulse rounded-[1.6rem] bg-foreground/[0.05] dark:bg-white/[0.06]" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="h-16 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
        <div className="h-16 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
        <div className="h-16 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
    </div>
  );
}

/** One kind inside the hero (0199) — its name and symbol (Tokens / Credits), the figure, what it is for. */
function KindFigure({ kind, hint, value }: { kind: WalletKind; hint: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/12 px-3 py-2.5 ring-1 ring-inset ring-white/20">
      <dt className="flex items-center gap-1 text-[11.5px] font-semibold leading-tight text-white/75">
        <KindSymbol kind={kind} />
        {KIND_NAME[kind].title}
      </dt>
      <dd className="mt-0.5 truncate text-[17px] font-bold tabular-nums">{value}</dd>
      <dd className="text-[11px] leading-snug text-white/60">{hint}</dd>
    </div>
  );
}
