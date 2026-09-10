"use client";

import { ChevronRight, History, Loader2, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatCents } from "@/lib/ai/economy";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI DASHBOARD — balance, allowance, price, history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "I still don't see the dashboard and all we have been
 * doing about the dashboard, deposit, usage and all, it should be on this page."
 *
 * Fair. The balance, the ledger, the atomic charge, the Paystack top-up and the
 * admin controls were all built and wired, and NONE of it had a surface. From
 * where the owner sits that is indistinguishable from nothing having been
 * built — a system that works and cannot be seen has not shipped.
 *
 * The standing rule's §17 asks for exactly this panel: AI Balance with a
 * Recharge button, today's usage, weekly usage, the current price, and usage
 * history directly below.
 *
 * ── 🔴 IT RENDERS NOTHING UNTIL IT KNOWS SOMETHING ──────────────────────────
 *
 * No skeleton of zeroes. "0 free left" and "$0.00" are both statements about
 * somebody's account, and showing them before the answer arrives tells a member
 * with credit that they have none — for as long as the request takes, on
 * exactly the connection where it takes longest. The panel is absent, then
 * correct.
 *
 * ── 🔴 ONE REQUEST, AND NO POLLING ──────────────────────────────────────────
 *
 * `/api/ai/balance` returns all five facts together because they are one panel
 * and are meaningless apart. It is fetched on mount and after a job completes —
 * never on a timer. This sits on a page somebody leaves open while a video
 * processes, and an interval here would be the battery rule broken for a number
 * that changes twice a day.
 *
 * ── Money is displayed, never computed ──────────────────────────────────────
 *
 * Every amount arrives as integer minor units and passes through `formatCents`
 * once, on the way to the screen. Nothing here adds, subtracts or compares
 * money — `/start` re-resolves all of it server-side before it charges, so this
 * panel is display only and could not authorise anything if it tried.
 */

interface DashboardState {
  balanceCents: number;
  symbol: string;
  priceCents: number;
  topupOptionsCents: number[];
  usedToday: number;
  dailyLimit: number;
  usedThisWeek: number;
  weeklyLimit: number;
  freeRemaining: number;
  weekResetsAt: string;
  ledger: {
    id: string;
    deltaCents: number;
    kind: "topup" | "admin_credit" | "job_charge" | "job_refund";
    createdAt: string;
  }[];
}

export function FrenzAIDashboard({
  historyHref,
  className,
}: {
  historyHref: string;
  className?: string;
}) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/balance", { cache: "no-store" });
      if (!res.ok) return;
      setState((await res.json()) as DashboardState);
    } catch {
      /* the panel simply stays absent — see the note above */
    }
  }, []);

  useEffect(() => {
    void load();
    /*
      Re-read when a job finishes. `AiJobAlert` is the one thing that knows,
      and it already runs app-wide — so this listens rather than polling.
    */
    const onDone = () => void load();
    window.addEventListener("frenz-ai:job-finished", onDone);
    return () => window.removeEventListener("frenz-ai:job-finished", onDone);
  }, [load]);

  const topup = async (amountCents: number) => {
    setBusy(true);
    setError(null);
    haptic("selection");
    try {
      const res = await fetch("/api/ai/balance/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "We couldn't start that payment. Try again.");
        setBusy(false);
        return;
      }
      /*
        🔴 A full navigation to Paystack's hosted page, not a popup or an
        iframe. Card entry belongs on the payment provider's own origin — it is
        their PCI scope, their fraud tooling, and the only place a member can
        check the padlock against a name they recognise.
      */
      window.location.href = json.url;
    } catch {
      setError("We couldn't start that payment. Try again.");
      setBusy(false);
    }
  };

  if (!state) return null;

  const outOfFree = state.freeRemaining <= 0;
  const canAfford = state.balanceCents >= state.priceCents;

  return (
    <section className={cn("rounded-[1.5rem] border border-border/70 bg-card/95 p-4", className)}>
      {/* ── balance, and the way to add to it ───────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            AI balance
          </p>
          <p className="mt-0.5 text-[1.75rem] font-bold leading-none tabular-nums">
            {formatCents(state.balanceCents, state.symbol)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic("selection");
            setShowTopup((v) => !v);
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 text-white",
            "shadow-[0_10px_26px_-12px_rgb(99_102_241/0.9)] transition active:scale-[0.98]",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Recharge
        </button>
      </div>

      {/* ── the three facts, as the reference asks ──────────────────────── */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Fact
          label="Today"
          value={`${state.usedToday} / ${state.dailyLimit}`}
          hint="free"
          spent={state.usedToday >= state.dailyLimit}
        />
        <Fact
          label="This week"
          value={`${state.usedThisWeek} / ${state.weeklyLimit}`}
          hint="free"
          spent={state.usedThisWeek >= state.weeklyLimit}
        />
        <Fact label="Per video" value={formatCents(state.priceCents, state.symbol)} hint="after free" />
      </dl>

      {/*
        ── 🔴 THE RECHARGE STATE, AND ITS TONE ──────────────────────────────

        §18: "Show a clear professional state… Do not use aggressive advertising
        language. Do not tell users to watch ads to continue AI processing."

        So it states three facts and offers one action. It appears only when the
        free allowance is actually spent AND the balance will not cover a video —
        a member with credit is simply charged and never sees this at all.
      */}
      {outOfFree && !canAfford ? (
        <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-3.5">
          <p className="text-[13.5px] font-bold">AI balance too low</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Your free AI allowance has been used for this period. Recharge your AI balance to keep
            going — {formatCents(state.priceCents, state.symbol)} per video. Free videos come back{" "}
            {resetWording(state.weekResetsAt)}.
          </p>
        </div>
      ) : null}

      {/* ── the amounts, revealed rather than always present ────────────── */}
      {showTopup ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Add balance
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {state.topupOptionsCents.map((cents) => (
              <button
                key={cents}
                type="button"
                disabled={busy}
                onClick={() => void topup(cents)}
                className={cn(
                  "rounded-xl border border-border/70 bg-background px-2 py-2.5 text-[13px] font-bold tabular-nums",
                  "transition hover:border-foreground/25 active:scale-[0.97] disabled:opacity-60",
                )}
              >
                {formatCents(cents, state.symbol)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {busy ? "Opening secure checkout…" : "Paid securely through Paystack."}
          </p>
          {error ? (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── recent activity, and the way to the full list ───────────────── */}
      {state.ledger.length > 0 ? (
        <div className="mt-4 border-t border-border/60 pt-3">
          <ul className="space-y-1.5">
            {state.ledger.slice(0, 3).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate text-muted-foreground">{LEDGER_LABEL[row.kind]}</span>
                <span
                  className={cn(
                    "shrink-0 font-bold tabular-nums",
                    row.deltaCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                  )}
                >
                  {row.deltaCents > 0 ? "+" : ""}
                  {formatCents(row.deltaCents, state.symbol)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link
        href={historyHref}
        className="mt-3 flex items-center justify-between gap-2 rounded-xl px-1 py-1.5 text-[13px] font-semibold transition hover:text-primary"
      >
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          Usage &amp; history
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Link>

      {busy ? (
        <span className="sr-only" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening checkout
        </span>
      ) : null}
    </section>
  );
}

/**
 * 🔴 A total `Record` over the ledger's kinds, so a new entry type fails the
 * BUILD here rather than rendering as an empty row on somebody's statement.
 */
const LEDGER_LABEL: Record<DashboardState["ledger"][number]["kind"], string> = {
  topup: "Balance added",
  admin_credit: "Credit from Frenz",
  job_charge: "AI video",
  job_refund: "Refunded — job didn't finish",
};

function Fact({
  label,
  value,
  hint,
  spent,
}: {
  label: string;
  value: string;
  hint: string;
  spent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-secondary/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-[15px] font-bold tabular-nums leading-none",
          // Amber rather than red: a spent allowance is an ordinary state with
          // a next step, not a failure.
          spent && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</dd>
    </div>
  );
}

/**
 * "on Monday", or "tomorrow" when that is what Monday is.
 *
 * 🔴 Said as a DAY, never a timestamp. "Your free videos come back at
 * 00:00 UTC on 2026-09-14" is a true sentence nobody can act on; the weekly
 * boundary is Monday and that is the useful half of it.
 */
function resetWording(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "next week";
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days <= 1) return "tomorrow";
  return `on ${new Date(at).toLocaleDateString(undefined, { weekday: "long" })}`;
}
