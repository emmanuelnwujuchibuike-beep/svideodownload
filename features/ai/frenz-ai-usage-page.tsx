"use client";

import { ArrowLeft, ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { formatCents } from "@/lib/ai/economy";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai/usage — the member's usage, and the whole statement behind it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "The usage and history button in the AI page should open
 * the usage page, not the history page, because there is already a history
 * card button below."
 *
 * There was no usage page. The dashboard sheet's "Usage & history" row pointed
 * at /ai/history because that was the only place with any of this on it — and
 * the tool grid directly beneath already carries a full "Your AI videos" card
 * to the same place. Two doors, three inches apart, to one room; and nowhere
 * at all to read the statement past its five most recent lines.
 *
 * ── What this page is ──────────────────────────────────────────────────────
 *
 * The same `/api/ai/balance` read the dashboard sheet makes, asked for the
 * full ledger (`?ledger=100`) and laid out as a page rather than a sheet:
 *
 *   · the balance, the price per video, and the way to add more;
 *   · today's and this week's free counters, as bars, with when they reset;
 *   · every ledger line, grouped by day, each with its running balance.
 *
 * It renders NOTHING numeric until the read succeeds — the dashboard's rule,
 * for the dashboard's reason: a skeleton of zeroes is a statement about
 * somebody's account, not a placeholder.
 *
 * ── Why it is not a second copy of the dashboard ───────────────────────────
 *
 * The sheet is for acting (recharge, verify, refresh) and shows five lines.
 * This is for reading, and shows them all. The two share the endpoint, the
 * money formatter and the ledger labels; they do not share layout, because a
 * sheet and a page are not the same surface.
 */

type LedgerKind = "topup" | "admin_credit" | "job_charge" | "job_refund";

interface UsageState {
  balanceCents: number;
  symbol: string;
  priceCents: number;
  usedToday: number;
  dailyLimit: number;
  usedThisWeek: number;
  weeklyLimit: number;
  freeRemaining: number;
  weekResetsAt: string;
  ledger: {
    id: string;
    deltaCents: number;
    balanceAfterCents: number;
    kind: LedgerKind;
    createdAt: string;
  }[];
}

/**
 * 🔴 A total `Record` over the ledger's kinds — a new kind fails the build
 * here rather than rendering as a blank line on somebody's statement. Same
 * labels as the dashboard sheet, on purpose: one vocabulary.
 */
const LEDGER_LABEL: Record<LedgerKind, string> = {
  topup: "Balance added",
  admin_credit: "Credit from Frenz",
  job_charge: "AI video",
  job_refund: "Refunded — job didn't finish",
};

export function FrenzAIUsagePage({ aiHref = "/ai" }: { aiHref?: string }) {
  const [state, setState] = useState<UsageState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/ai/balance?ledger=100", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setState((await res.json()) as UsageState);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Today / Yesterday / This week / Last week / Earlier — the same boundaries
    the AI history and the download gallery use, so a member reads one
    calendar across the product. Empty buckets are dropped.
  */
  const sections = useMemo(() => {
    if (!state) return [];
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    const yesterday = today - 86_400_000;
    const week = today - 6 * 86_400_000;
    const lastWeek = today - 13 * 86_400_000;
    const buckets: { key: string; label: string; items: UsageState["ledger"] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "week", label: "This week", items: [] },
      { key: "lastweek", label: "Last week", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const row of state.ledger) {
      const t = Date.parse(row.createdAt);
      const at = Number.isFinite(t) ? t : 0;
      const i = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : at >= lastWeek ? 3 : 4;
      buckets[i]!.items.push(row);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [state]);

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
        <FrenzAICrumb tool="Usage" />

        <h1 className="mt-4 text-[1.9rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[2.2rem]">
          Your <span className="text-gradient">usage</span>
        </h1>
        <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
          What you have used, what you have left, and every line of your Frenz AI balance.
        </p>

        {failed ? (
          <div className="mt-6 rounded-2xl bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
            <p className="text-[13.5px] text-muted-foreground">Couldn&apos;t load your usage right now.</p>
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

        {!state && !failed ? <UsageSkeleton /> : null}

        {state ? (
          <>
            {/* ── balance and price ─────────────────────────────────────── */}
            <section
              aria-label="Balance"
              className="mt-6 rounded-[1.5rem] bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Balance
                  </p>
                  <p className="mt-1 text-[2rem] font-bold leading-none tracking-[-0.03em] tabular-nums">
                    {formatCents(state.balanceCents, state.symbol)}
                  </p>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {formatCents(state.priceCents, state.symbol)} per video after your free ones.
                  </p>
                </div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                  <Wallet className="h-5 w-5" aria-hidden />
                </span>
              </div>
              <Link
                href={aiHref}
                prefetch={false}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition active:scale-[0.98]"
              >
                Add balance
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>

            {/* ── free counters ─────────────────────────────────────────── */}
            <section aria-label="Free videos" className="mt-4 grid gap-3 sm:grid-cols-2">
              <Meter
                label="Today"
                used={state.usedToday}
                limit={state.dailyLimit}
                hint="Resets at midnight"
              />
              <Meter
                label="This week"
                used={state.usedThisWeek}
                limit={state.weeklyLimit}
                hint={`Resets ${formatDate(state.weekResetsAt)}`}
              />
            </section>
            <p className="mt-3 text-[13px] text-muted-foreground">
              {state.freeRemaining > 0
                ? `${state.freeRemaining} free ${state.freeRemaining === 1 ? "video" : "videos"} left right now.`
                : "No free videos left right now — your balance covers the rest."}
            </p>

            {/* ── the statement ─────────────────────────────────────────── */}
            <section aria-label="Statement" className="mt-8">
              <h2 className="text-[1.05rem] font-bold tracking-[-0.02em]">Statement</h2>
              {sections.length === 0 ? (
                <p className="mt-2 text-[13.5px] text-muted-foreground">
                  Nothing yet. Your first AI video, top-up or refund will appear here.
                </p>
              ) : (
                sections.map((section) => (
                  <div key={section.key} className="mt-4">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {section.label}
                    </h3>
                    <ul className="mt-2 divide-y divide-border/60 rounded-2xl bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
                      {section.items.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold">{LEDGER_LABEL[row.kind]}</p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              {formatDate(row.createdAt)} · {formatTime(row.createdAt)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p
                              className={cn(
                                "text-[14px] font-bold tabular-nums",
                                row.deltaCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                              )}
                            >
                              {row.deltaCents > 0 ? "+" : ""}
                              {formatCents(row.deltaCents, state.symbol)}
                            </p>
                            <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
                              {formatCents(row.balanceAfterCents, state.symbol)} after
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              {state.ledger.length >= 100 ? (
                <p className="mt-3 text-[12px] text-muted-foreground">Showing your most recent 100 lines.</p>
              ) : null}
            </section>
          </>
        ) : null}

        <div className="mt-8">
          <Link
            href={aiHref}
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Frenz AI
          </Link>
        </div>
      </div>
    </FrenzAIEnvironment>
  );
}

/**
 * A used/limit bar. A limit of 0 means NO free videos on this plan — not
 * "unlimited" (`freeRemaining` is min(daily, weekly) remaining, so a zero
 * limit is zero free). The bar says that in words rather than drawing "0 / 0".
 */
function Meter({ label, used, limit, hint }: { label: string; used: number; limit: number; hint: string }) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
  return (
    <div className="rounded-2xl bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <p className="text-[13px] font-bold tabular-nums">
          {limit > 0 ? `${used} / ${limit}` : "None free"}
        </p>
      </div>
      <div
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-foreground/[0.06] dark:bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-label={`${label}: ${used} of ${limit} free videos used`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {limit > 0 ? hint : "No free videos on your plan — each one uses your balance."}
      </p>
    </div>
  );
}

/** Shapes only — no numbers, for the reason at the top of the file. */
function UsageSkeleton() {
  return (
    <div className="mt-6 space-y-4" aria-hidden>
      <div className="h-[8.5rem] animate-pulse rounded-[1.5rem] bg-foreground/[0.05] dark:bg-white/[0.06]" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
        <div className="h-24 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-foreground/[0.05] dark:bg-white/[0.06]" />
    </div>
  );
}
