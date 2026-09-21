"use client";

import { Crown, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiPlansSheet, relative } from "@/features/ai/credits/ai-plans-sheet";
import { getAiCredits, openAiPlanManage, type AiCreditsAnswer } from "@/lib/ai/credits/client";
import { formatCents } from "@/lib/ai/economy";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ALLOWANCE — "AI PRO · 15 daily · 70 weekly · today 8/15 · week 32/70"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "The AI UI should clearly show the user's current AI
 * allowance … Make the presentation premium and native-app-like. Do not make
 * the interface look like a generic SaaS dashboard … Use elegant progress
 * indicators rather than excessive text."
 *
 * Two rings — today and this week — from one read of `/api/ai/credits`.
 * Nothing is computed here: the used, the limits, the resets are the
 * server's, under the operator's reset zone. A member on no plan sees the
 * plan cards' door instead. Re-read when the page comes back into view and
 * after a start (`refreshKey`), never on a timer.
 */
export function AiCreditsCard({ className, refreshKey = 0, returnTo, compact = false, onLoaded }: { className?: string; refreshKey?: number; returnTo: string; compact?: boolean; onLoaded?: (answer: AiCreditsAnswer) => void }) {
  const [data, setData] = useState<AiCreditsAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    const res = await getAiCredits();
    if (res.ok) {
      const { ok: _ok, ...answer } = res;
      setData(answer as AiCreditsAnswer);
      setError(null);
      onLoaded?.(answer as AiCreditsAnswer);
    } else if (res.code !== "AUTH_REQUIRED") setError(res.error);
  }, [onLoaded]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, refreshKey]);

  const manage = useCallback(async () => {
    setManaging(true);
    haptic("selection");
    const res = await openAiPlanManage();
    setManaging(false);
    if (res.ok) window.location.assign(res.url);
    else setError(res.error);
  }, []);

  if (!data) {
    return <div className={cn("h-28 animate-pulse rounded-[1.5rem] bg-secondary/60", className)} aria-busy="true" aria-label="Loading your AI allowance" />;
  }
  const e = data.entitlement;
  const plansOn = data.plans.enabled && data.plans.plans.length > 0;
  if (!plansOn && !e.plan) return null;

  if (!e.plan) {
    // no plan: the door to one — one line, one button, never a dashboard
    const cheapest = [...data.plans.plans].sort((a, b) => a.priceCents - b.priceCents)[0];
    return (
      <>
        <section className={cn("relative overflow-hidden rounded-[1.5rem] border border-border/70 bg-card px-4 py-4", className)}>
          <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.16),transparent)] blur-2xl" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">AI plans</p>
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                {cheapest ? `From ${formatCents(cheapest.priceCents, data.plans.symbol)}/${cheapest.interval === "yearly" ? "year" : "month"} · ${cheapest.dailyCredits} credits a day, ${cheapest.weeklyCredits} a week.` : "Daily and weekly credits for every AI feature."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                setSheet(true);
              }}
              className="btn-lux min-h-[42px] shrink-0 bg-foreground px-4 text-[13px] text-background"
            >
              See plans
            </button>
          </div>
        </section>
        <AiPlansSheet open={sheet} onClose={() => setSheet(false)} plans={data.plans} currentPlan={null} returnTo={returnTo} />
      </>
    );
  }

  const top = e.plan === "ai_max";
  return (
    <>
      <section
        aria-label={`${e.planLabel}: ${e.usedToday} of ${e.dailyLimit} credits used today, ${e.usedThisWeek} of ${e.weeklyLimit} this week`}
        className={cn("relative overflow-hidden rounded-[1.5rem] border border-border/70 bg-card px-4 py-4", className)}
      >
        <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.18),transparent)] blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {top ? <Crown className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
              {e.planLabel}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{e.dailyLimit}</span> daily · <span className="font-semibold text-foreground tabular-nums">{e.weeklyLimit}</span> weekly
            </p>
          </div>
          {e.subscription?.cancelAtPeriodEnd && e.subscription.currentPeriodEnd ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-bold text-amber-700 dark:text-amber-400">Ends {new Date(e.subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          ) : e.subscription?.status === "past_due" ? (
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-bold text-rose-600">Payment due</span>
          ) : null}
        </div>

        <div className={cn("relative mt-4 grid gap-3", compact ? "grid-cols-2" : "grid-cols-2")}>
          <Ring label="Today" used={e.usedToday} limit={e.dailyLimit} remaining={e.remainingToday} resetsAt={e.dayResetsAt} />
          <Ring label="This week" used={e.usedThisWeek} limit={e.weeklyLimit} remaining={e.remainingThisWeek} resetsAt={e.weekResetsAt} />
        </div>

        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            Remaining: <span className="font-semibold text-foreground tabular-nums">{e.remainingToday}</span> today · <span className="font-semibold text-foreground tabular-nums">{e.remainingThisWeek}</span> this week
          </p>
          <span className="ml-auto flex items-center gap-2">
            {e.plan === "ai_pro" && data.plans.plans.some((p) => p.id === "ai_max" && p.purchasable) ? (
              <button
                type="button"
                onClick={() => {
                  haptic("selection");
                  setSheet(true);
                }}
                className="btn-lux min-h-[38px] bg-foreground px-3.5 text-[12.5px] text-background"
              >
                Upgrade to {data.plans.plans.find((p) => p.id === "ai_max")?.label ?? "AI Max"}
              </button>
            ) : null}
            {e.subscription?.manageable ? (
              <button type="button" onClick={() => void manage()} disabled={managing} className="btn-lux min-h-[38px] border border-border/70 bg-card px-3.5 text-[12.5px] text-foreground hover:border-foreground/25">
                {managing ? "Opening…" : "Manage"}
              </button>
            ) : null}
          </span>
        </div>
        {error ? <p className="relative mt-2 text-[12px] font-semibold text-rose-500">{error}</p> : null}
      </section>
      <AiPlansSheet open={sheet} onClose={() => setSheet(false)} plans={data.plans} currentPlan={e.plan} returnTo={returnTo} />
    </>
  );
}

/** One ring: used of limit, the remainder beside it, the reset under it. SVG, no library. */
function Ring({ label, used, limit, remaining, resetsAt }: { label: string; used: number; limit: number; remaining: number; resetsAt: string }) {
  const fraction = limit > 0 ? Math.min(1, used / limit) : 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  const tone = remaining === 0 ? "text-rose-500" : fraction > 0.75 ? "text-amber-500" : "text-primary";
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 px-3 py-2.5">
      <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-border/70" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} className={cn("transition-[stroke-dashoffset] duration-500", tone)} />
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <p className="text-[17px] font-bold leading-tight tabular-nums">
          {used} <span className="text-[12px] font-semibold text-muted-foreground">/ {limit}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          {remaining} left · resets {relative(resetsAt)}
        </p>
      </div>
    </div>
  );
}
