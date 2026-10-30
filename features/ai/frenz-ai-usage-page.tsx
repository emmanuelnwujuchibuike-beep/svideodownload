"use client";

import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, RotateCcw, ShieldCheck, Gift, Trophy, type LucideIcon, Clapperboard } from "lucide-react";
import dynamic from "next/dynamic";

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
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { takeTopupReturnReference, verifyCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import { formatCredits, formatLedgerAmount, WALLET_UNIT } from "@/lib/ai/credits/units";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { topupReturnLine } from "@/lib/ai/wallet/topup-return";
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

/** Step 23: the statement's chips, mapped onto the ledger's own kinds (nothing reclassified). */
type StatementFilter = "all" | "earned" | "transfers" | "spent";
const STATEMENT_FILTERS: { id: StatementFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "earned", label: "Earned" },
  { id: "transfers", label: "Transfers" },
  { id: "spent", label: "Spent" },
];
const FILTER_KINDS: Record<Exclude<StatementFilter, "all">, readonly LedgerKind[]> = {
  earned: ["recharge", "bonus", "grant", "refund", "withdrawal_reversal"],
  transfers: ["transfer_in", "transfer_out", "transfer_fee"],
  spent: ["processing_charge", "withdrawal"],
};

const LEDGER_COPY: Record<LedgerKind, { label: string; Icon: LucideIcon; tone: "in" | "out" | "neutral" }> = {
  recharge: { label: "Credits added", Icon: ArrowDownLeft, tone: "in" },
  // 0184: a pack's bonus credits, and credits the product gives
  bonus: { label: "Bonus credits", Icon: Gift, tone: "in" },
  grant: { label: "Credits earned", Icon: Trophy, tone: "in" },
  // 0187: cashing out withdrawable reward credits, and a withdrawal that was returned
  withdrawal: { label: "Withdrawal", Icon: ArrowDownLeft, tone: "out" },
  withdrawal_reversal: { label: "Withdrawal returned", Icon: RotateCcw, tone: "in" },
  // 0193: credits sent to / received from another member's wallet, and the 5% fee
  transfer_out: { label: "Credits sent", Icon: ArrowUpRight, tone: "out" },
  transfer_in: { label: "Credits received", Icon: ArrowDownLeft, tone: "in" },
  transfer_fee: { label: "Transfer fee", Icon: ArrowUpRight, tone: "out" },
  // 2026-10-06: the one AI wallet pays for every tool now — Character Replace is retired
  processing_charge: { label: "Frenz AI creation", Icon: Clapperboard, tone: "out" },
  refund: { label: "Refunded — the video didn't finish", Icon: RotateCcw, tone: "in" },
  adjustment: { label: "Adjustment by Frenz", Icon: ShieldCheck, tone: "neutral" },
  reversal: { label: "Reversed", Icon: RotateCcw, tone: "neutral" },
};

// 2026-10-07 (owner): the subscription celebration + optional survey — its chunk loads only when there is a plan to celebrate
const WithdrawChooser = dynamic(() => import("@/features/ai/wallet/withdraw-chooser").then((m) => m.WithdrawChooser), { ssr: false });
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
  slides = [],
}: {
  aiHref?: string;
  slides?: ShowcaseSlide[];
}) {
  // owner brief 2026-10-11: "Explore AI tools" became Withdraw — AI Credits or SUB earnings
  const [withdrawOpen, setWithdrawOpen] = useState(false);
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
        // Part 4: one honest line for every outcome — including a failed payment and a check that couldn't run
        setNotice(topupReturnLine(verified));
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

  const [statementFilter, setStatementFilter] = useState<StatementFilter>("all");
  // owner 2026-10-20: the Statement collapses (remembered on this device)
  const [statementOpen, setStatementOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("frenz:statement-open") === "0") setStatementOpen(false);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleStatement = () => {
    haptic("selection");
    setStatementOpen((o) => {
      try {
        localStorage.setItem("frenz:statement-open", o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  /* ── Today / Yesterday / This week / Last week / Earlier — the product's one calendar ── */
  const sections = useMemo(() => {
    if (!ledger) return [];
    const rows = statementFilter === "all" ? ledger : ledger.filter((row) => FILTER_KINDS[statementFilter].includes(row.kind));
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
    for (const row of rows) {
      const t = Date.parse(row.createdAt);
      const at = Number.isFinite(t) ? t : 0;
      const i = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : at >= lastWeek ? 3 : 4;
      buckets[i]!.items.push(row);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [ledger, statementFilter]);

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
        {/* step 23 (design/Credits.dc.html, owner 2026-10-19): ‹ Frenz AI, then the large title */}
        <header className="frenz-ui px-1 text-frenz-ink">
          <TapOnceLink href={aiHref} spinner={false} className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] font-bold text-frenz-blue no-underline">
            <ChevronLeft className="h-5 w-5" aria-hidden /> Frenz AI
          </TapOnceLink>
          <h1 className="m-0 font-heading text-[34px] font-extrabold leading-tight tracking-[-1px]">Credits</h1>
        </header>

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
                // the balance card is identity (the brand gradient), never the page ground — the page stays white
                "bg-frenz-gradient shadow-frenz-raised",
              )}
            >
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-white/85">AI balance</p>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("selection");
                      toggleHidden();
                    }}
                    aria-pressed={hidden}
                    aria-label={hidden ? "Show balance" : "Hide balance"}
                    className="mt-1.5 block rounded-lg text-left font-heading text-[2.6rem] font-extrabold leading-none tracking-[-1.5px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:text-[3.25rem]"
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
              {/* 0199 (owner, 2026-10-08): the two kinds apart — the total above is what every tool spends from. 2026-10-30 (owner:
                  "remove the AI token, so only AI credit is there"): the split shows for an approved AFFILIATE only — the one member
                  who can cash out; for everyone else the total above is simply their AI credits */}
              {balance.affiliate && typeof balance.withdrawableCents === "number" ? (
                <dl aria-label="Your credits by kind" className="relative mt-4 grid grid-cols-2 gap-2">
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
              <div className="relative mt-5 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => openSheet(null)}
                  className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-white font-heading text-[15px] font-bold text-frenz-violet transition active:scale-[0.98]"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Top up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    setWithdrawOpen(true);
                  }}
                  className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-white/15 font-heading text-[15px] font-bold text-white ring-1 ring-inset ring-white/30 transition active:scale-[0.98]"
                >
                  <ArrowDownLeft className="h-4 w-4" aria-hidden />
                  Withdraw
                </button>
                {withdrawOpen ? <WithdrawChooser onClose={() => setWithdrawOpen(false)} affiliate={!!balance.affiliate} creditsLabel={typeof balance.withdrawableCents === "number" && !hidden ? formatKind(balance.withdrawableCents, "withdrawable") : null} /> : null}
              </div>
              {balance.offer.packs.length > 0 ? (
                <div className="relative mt-3 grid grid-cols-4 gap-1.5" aria-label="Quick credit packs">
                  {balance.offer.packs.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openSheet(p.credits)}
                      className="h-9 truncate rounded-full bg-white/12 px-1 text-[13px] font-bold tabular-nums text-white ring-1 ring-inset ring-white/28 transition active:scale-95"
                    >
                      +{formatCredits(p.credits, { short: true })}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {/* 2026-10-14 the qualification progress card stood here — removed 2026-10-30 (owner): cashing out AI credits is for
                approved affiliates, through support; nobody works towards a qualification any more */}

            {/* ── 0167: the AI plan and its allowance — or the door to one ─────── */}
            {/* design/Credits.dc.html: AI plans and Rewards & referrals share ONE bordered card, a hairline between them */}
            <div className="frenz-ui mt-4 divide-y divide-frenz-line overflow-hidden rounded-[22px] border border-frenz-line bg-frenz-card">
            <AiCreditsCard className="!rounded-none !bg-transparent !shadow-none !ring-0" refreshKey={creditsKey} returnTo="/studio/ai/usage" />

            {/* 2026-10-07 (owner brief §7, §11): rewards and referrals — AI Credits vs Withdrawable live on /rewards */}
            <TapOnceLink
              href="/rewards"
              spinner={false}
              className="flex min-h-[60px] items-center gap-3 px-3.5 py-3 text-frenz-ink no-underline transition active:bg-frenz-fill data-[pending]:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-frenz-violet"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-frenz-violet/10 text-frenz-violet">
                <Gift className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">Rewards &amp; referrals</span>
                <span className="block text-[13px] text-frenz-muted">Earn by creating, sharing and inviting</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </TapOnceLink>
            </div>

            {/* 0193 (owner 2026-10-07): send credits to a wallet number, and the transfer history */}
            <TransferPanel className="mt-4" affiliate={!!balance?.affiliate} rules={balance?.offer?.transfers ?? null} balance={balance?.balanceCents ?? null} withdrawable={balance?.withdrawableCents ?? null} deposited={balance?.depositedCents ?? null} onChanged={() => void load()} />

            {/* ── three figures, from the statement itself ─────────────────── */}
            {figures ? (
              <section aria-label="Your account at a glance" className="mt-4 grid grid-cols-3 divide-x divide-frenz-line rounded-[22px] bg-frenz-fill py-3">
                <Figure label="Creations" value={String(figures.videos)} />
                <Figure label="Credits spent" value={hidden ? HIDDEN_AMOUNT : formatCredits(figures.spent, { short: true })} />
                <Figure label="Refunded" value={hidden ? HIDDEN_AMOUNT : formatCredits(figures.refunded, { short: true })} tone={figures.refunded > 0 ? "in" : undefined} />
              </section>
            ) : null}
            {figures?.partial ? <p className="mt-2 text-[11.5px] text-muted-foreground">Counted from your most recent 100 lines.</p> : null}

            {/* ── the statement ─────────────────────────────────────────── */}
            <section aria-label="Statement" className="mt-8">
              <button type="button" onClick={toggleStatement} aria-expanded={statementOpen} aria-controls="statement-body" className="frenz-ui flex min-h-[44px] w-full items-center justify-between gap-3 px-1 text-left">
                <h2 className="m-0 font-heading text-[20px] font-bold text-frenz-ink">Statement</h2>
                <span className="flex items-center gap-1 text-[13px] text-frenz-muted">
                  {statementOpen ? "Newest first" : ledger ? `${ledger.length} lines` : ""}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", statementOpen && "rotate-180")} aria-hidden />
                </span>
              </button>
              <div id="statement-body" hidden={!statementOpen}>
              <div role="radiogroup" aria-label="Show" className="mt-2.5 grid grid-cols-4 gap-0.5 rounded-xl bg-frenz-fill p-[3px]">
                {STATEMENT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={statementFilter === f.id}
                    onClick={() => {
                      haptic("selection");
                      setStatementFilter(f.id);
                    }}
                    className={cn("min-h-[38px] rounded-[9px] text-[13.5px] transition-colors", statementFilter === f.id ? "bg-frenz-card font-bold text-frenz-ink shadow-[0_1px_3px_rgba(18,17,26,0.12)]" : "font-semibold text-frenz-muted")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {sections.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-border/70 px-5 py-8 text-center">
                  <p className="text-sm font-semibold">{statementFilter === "all" ? "Nothing here yet" : "Nothing of this kind yet"}</p>
                  <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">Your first top-up, creation or refund will appear here.</p>
                </div>
              ) : (
                sections.map((section) => (
                  <div key={section.key} className="mt-4">
                    <h3 className="m-0 px-1 font-heading text-[15px] font-bold text-frenz-ink">{section.label}</h3>
                    <ul className="mt-2 divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card">
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
                                copy.tone === "in" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-frenz-fill text-frenz-ink/80",
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
              </div>
            </section>
            <StatementDetailSheet row={openLine} symbol={symbol} onClose={() => setOpenLine(null)} />
          </>
        ) : null}
        {celebrate ? <PlanCelebration {...celebrate} onClose={closeCelebration} /> : null}

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
    <div className="frenz-ui rounded-[18px] border border-frenz-line bg-frenz-card px-3 py-3 text-center shadow-frenz-card">
      <p className={cn("m-0 truncate font-heading text-[18px] font-bold tabular-nums text-frenz-ink", tone === "in" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
      <p className="m-0 mt-0.5 text-[12px] font-semibold text-frenz-muted">{label}</p>
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

/** One kind inside the hero (0199) — its name and symbol (AI credits / Withdrawable — an affiliate only), the figure, what it is for. */
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
