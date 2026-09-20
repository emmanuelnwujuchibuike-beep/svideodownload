"use client";

import { ArrowDownLeft, ArrowLeft, ChevronRight, Eye, EyeOff, PersonStanding, Plus, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CharacterReplaceRechargeSheet } from "@/features/ai/character-replace/recharge-sheet";
import { StatementDetailSheet, symbolFor } from "@/features/ai/statement-detail-sheet";
import { HIDDEN_AMOUNT, useBalanceHidden } from "@/lib/ai/character-replace/balance-privacy";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { getCharacterReplaceBalance, takeTopupReturnReference, verifyCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance, CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
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
type LedgerKind = "recharge" | "processing_charge" | "refund" | "adjustment" | "reversal";

type LedgerRow = CharacterReplaceTransaction;

const LEDGER_COPY: Record<LedgerKind, { label: string; Icon: typeof Sparkles; tone: "in" | "out" | "neutral" }> = {
  recharge: { label: "Balance added", Icon: ArrowDownLeft, tone: "in" },
  processing_charge: { label: "Character Replace video", Icon: PersonStanding, tone: "out" },
  refund: { label: "Refunded — the video didn't finish", Icon: RotateCcw, tone: "in" },
  adjustment: { label: "Adjustment by Frenz", Icon: ShieldCheck, tone: "neutral" },
  reversal: { label: "Reversed", Icon: RotateCcw, tone: "neutral" },
};

export function FrenzAIUsagePage({ aiHref = "/ai", createHref = "/studio/ai/character-replace" }: { aiHref?: string; createHref?: string }) {
  const [balance, setBalance] = useState<CharacterReplaceBalance | null>(null);
  /* 2026-09-20: a tap on the figure hides it (kept per browser); a tap on a line opens it in full */
  const [hidden, toggleHidden] = useBalanceHidden();
  const [openLine, setOpenLine] = useState<LedgerRow | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const wallet = await getCharacterReplaceBalance({ ledger: 100 });
    if (!wallet.ok) {
      setFailed(true);
      return;
    }
    setBalance(wallet.balance);
    setLedger(wallet.transactions);
  }, []);

  useEffect(() => {
    /*
      The return from Paystack, if this is one: the reference leaves the
      address bar first, is verified once, then the wallet is re-read — the
      same contract the workspace keeps, so a recharge started HERE finishes
      here, with the new balance on screen.
    */
    const reference = takeTopupReturnReference();
    void (async () => {
      if (reference) {
        const verified = await verifyCharacterReplaceTopup(reference);
        setNotice(verified.ok ? (verified.credited ? "Payment received — your balance has been updated." : verified.pending ? "Your payment is still being confirmed. This will update shortly." : null) : null);
      }
      await load();
    })();
  }, [load]);

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
      if (row.kind === "processing_charge") {
        videos += 1;
        spent += -row.deltaCents;
      } else if (row.kind === "refund") refunded += row.deltaCents;
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
    <FrenzAIEnvironment stage="idle" className="relative overflow-hidden rounded-[1.75rem]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 40% at 20% 0%, rgba(99,102,241,0.10) 0%, transparent 62%)," +
            "radial-gradient(60% 40% at 92% 26%, rgba(217,70,239,0.08) 0%, transparent 66%)",
        }}
      />

      <div className="px-4 pb-10 pt-5 sm:px-6">
        <FrenzAICrumb tool="Balance" />

        <h1 className="mt-4 text-[1.9rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[2.2rem]">
          Your <span className="text-gradient">balance</span>
        </h1>
        <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
          What you have, what a video costs, and every line of your Frenz AI account.
        </p>

        {failed ? (
          <div className="mt-6 rounded-2xl bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
            <p className="text-[13.5px] text-muted-foreground">Couldn&apos;t load your balance right now.</p>
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                void load();
              }}
              className="mt-3 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
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
              <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
              <span aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-fuchsia-300/20 blur-3xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Character Replace balance</p>
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
                    {hidden ? <span aria-hidden>{HIDDEN_AMOUNT}</span> : formatCents(balance.balanceCents, symbol)}
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
                  Recharge
                </button>
                <Link
                  href={createHref}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white/90 ring-1 ring-inset ring-white/30 transition hover:bg-white/10"
                >
                  <PersonStanding className="h-4 w-4" aria-hidden />
                  Create a video
                </Link>
              </div>
              {balance.topupOptionsCents.length > 0 ? (
                <div className="relative mt-4 flex flex-wrap gap-1.5" aria-label="Quick recharge amounts">
                  {balance.topupOptionsCents.slice(0, 4).map((cents) => (
                    <button
                      key={cents}
                      type="button"
                      onClick={() => openSheet(cents)}
                      className="rounded-full bg-white/12 px-3 py-1.5 text-[12.5px] font-semibold tabular-nums text-white/90 ring-1 ring-inset ring-white/20 transition hover:bg-white/20"
                    >
                      + {formatCents(cents, symbol)}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {/* ── three figures, from the statement itself ─────────────────── */}
            {figures ? (
              <section aria-label="Your account at a glance" className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                <Figure label="Videos made" value={String(figures.videos)} />
                <Figure label="Spent" value={hidden ? HIDDEN_AMOUNT : formatCents(figures.spent, symbol)} />
                <Figure label="Refunded" value={hidden ? HIDDEN_AMOUNT : formatCents(figures.refunded, symbol)} tone={figures.refunded > 0 ? "in" : undefined} />
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
                  <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">Your first recharge, video or refund will appear here.</p>
                </div>
              ) : (
                sections.map((section) => (
                  <div key={section.key} className="mt-4">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{section.label}</h3>
                    <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
                      {section.items.map((row) => {
                        const copy = LEDGER_COPY[row.kind] ?? LEDGER_COPY.adjustment;
                        const Icon = copy.Icon;
                        const rowSymbol = symbolFor(row.currency, symbol);
                        return (
                          <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => {
                              haptic("selection");
                              setOpenLine(row);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50 focus-visible:outline-none focus-visible:bg-secondary/60"
                            aria-label={`${copy.label}, ${formatCents(row.deltaCents, rowSymbol)} — see the details`}
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
                                {row.deltaCents > 0 ? "+" : ""}
                                {formatCents(row.deltaCents, rowSymbol)}
                              </p>
                              <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">{formatCents(row.balanceAfterCents, rowSymbol)} after</p>
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

        <div className="mt-8">
          <Link href={aiHref} className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Frenz AI
          </Link>
        </div>
      </div>

      {sheetMounted && balance ? (
        <CharacterReplaceRechargeSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          balance={balance}
          returnTo={typeof window !== "undefined" ? window.location.pathname : "/studio/ai/usage"}
          suggestedCents={suggested}
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
