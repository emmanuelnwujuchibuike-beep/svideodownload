"use client";

import { Check, Crown, Sparkles, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import type { CharacterReplaceCreditsView } from "@/lib/ai/character-replace/types";
import { beginAiPlanCheckout } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCents } from "@/lib/ai/economy";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The sheet is the product's own (framer-motion inside) and is fetched only
  when a plan is asked for — the same split the recharge sheet uses.
*/
const GlassSheetShell = dynamic(() => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell), { ssr: false });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX — the plan cards, and the "not enough credits" moment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Show a premium upgrade experience … AI Pro $10/month
 * 15 daily 70 weekly · AI Max $20/month 50 daily 250 weekly … DO NOT
 * hard-code those prices in the UI. Read them from the admin configuration."
 *
 * Every figure on a card is the server's (`/api/ai/credits` → the operator's
 * configuration). Opened from the allowance card ("Get AI Pro") and from a
 * refused start (`CR_CREDITS_REQUIRED`): then it says exactly what was
 * short — required, available today, available this week — and, when the
 * operator's policy allows, offers the wallet for this one generation.
 */
export function AiPlansSheet({
  open,
  onClose,
  plans,
  currentPlan,
  shortfall = null,
  returnTo,
  onPayFromWallet,
  walletLabel,
}: {
  open: boolean;
  onClose: () => void;
  plans: AiPlansPublic | null;
  currentPlan: "ai_pro" | "ai_max" | null;
  /** The refused generation's figures, when the sheet opened for one. */
  shortfall?: (CharacterReplaceCreditsView & { walletOffered: boolean; priceLabel: string | null }) | null;
  returnTo: string;
  /** Present when the operator's policy offers the wallet for this generation. */
  onPayFromWallet?: () => void;
  walletLabel?: string;
}) {
  const [busy, setBusy] = useState<"ai_pro" | "ai_max" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(
    async (plan: "ai_pro" | "ai_max") => {
      setBusy(plan);
      setError(null);
      haptic("medium");
      const res = await beginAiPlanCheckout(plan, returnTo);
      if (!res.ok) {
        setBusy(null);
        setError(res.error);
        return;
      }
      window.location.assign(res.url);
    },
    [returnTo],
  );

  const offered = plans?.plans ?? [];
  const rank = (p: "ai_pro" | "ai_max" | null) => (p === "ai_max" ? 2 : p === "ai_pro" ? 1 : 0);

  return (
    <GlassSheetShell open={open} onClose={onClose} title={shortfall ? "Not enough AI credits" : "AI plans"} fitContent defaultHeightVh={84}>
      <div className="px-4 pb-6">
        {shortfall ? (
          <div className="rounded-[1.25rem] border border-amber-500/35 bg-amber-500/[0.07] px-4 py-3.5">
            <p className="text-[13.5px] font-bold">Not enough AI credits for this generation.</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Figure label="Required" value={shortfall.required} tone="warn" />
              <Figure label="Available today" value={shortfall.remainingToday} />
              <Figure label="Available this week" value={shortfall.remainingThisWeek} />
            </dl>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {shortfall.reason === "weekly" ? "This week's allowance is what's short." : "Today's allowance is what's short."} Today resets {relative(shortfall.dayResetsAt)}; the week resets {relative(shortfall.weekResetsAt)}.
            </p>
            {shortfall.walletOffered && onPayFromWallet ? (
              <button
                type="button"
                onClick={() => {
                  haptic("selection");
                  onPayFromWallet();
                }}
                className="btn-lux mt-3 min-h-[46px] w-full border border-border/70 bg-card text-foreground hover:border-foreground/25"
              >
                <Wallet className="h-4 w-4" aria-hidden />
                {walletLabel ?? (shortfall.priceLabel ? `Pay ${shortfall.priceLabel} from my balance instead` : "Pay from my balance instead")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted-foreground">An AI plan includes a daily and a weekly allowance of credits for Character Replace and every Pro and Business AI feature. Both allowances reset on their own — no top-ups to remember.</p>
        )}

        {!plans || !plans.enabled || offered.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-secondary px-4 py-3 text-center text-[13px] font-semibold text-muted-foreground">AI plans aren&apos;t available right now.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {offered.map((p) => {
              const isCurrent = currentPlan === p.id;
              const lower = rank(p.id) < rank(currentPlan);
              const top = p.id === "ai_max";
              return (
                <article
                  key={p.id}
                  className={cn(
                    "relative overflow-hidden rounded-[1.5rem] border bg-card p-4",
                    top ? "border-transparent bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_40px_-20px_rgba(79,70,229,0.6)]" : "border-border/70",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={cn("flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]", top ? "text-white/85" : "text-muted-foreground")}>
                        {top ? <Crown className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
                        {p.label}
                      </p>
                      <p className="mt-1.5 text-[26px] font-bold leading-none tabular-nums tracking-[-0.03em]">
                        {formatCents(p.priceCents, plans.symbol)}
                        <span className={cn("ml-1 text-[13px] font-semibold", top ? "text-white/80" : "text-muted-foreground")}>/{p.interval === "yearly" ? "year" : "month"}</span>
                      </p>
                    </div>
                    {isCurrent ? <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]", top ? "bg-white/20 text-white" : "bg-emerald-500/10 text-emerald-600")}>Your plan</span> : null}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    <Allowance label="Daily" value={p.dailyCredits} light={top} />
                    <Allowance label="Weekly" value={p.weeklyCredits} light={top} />
                  </dl>
                  <ul className={cn("mt-4 space-y-1.5 text-[12.5px] leading-snug", top ? "text-white/90" : "text-foreground")}>
                    {(p.id === "ai_max"
                      ? ["Everything in AI Pro", "Higher daily and weekly allowance", "Maximum AI usage tier"]
                      : ["Character Replace — every scope", "Pro and Business AI features", "Future eligible AI features"]
                    ).map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", top ? "text-white" : "text-primary")} aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={isCurrent || lower || !p.purchasable || busy !== null}
                    onClick={() => void subscribe(p.id)}
                    className={cn(
                      "mt-4 flex min-h-[48px] w-full items-center justify-center rounded-full text-[14px] font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
                      top ? "bg-white text-indigo-700" : "bg-foreground text-background",
                    )}
                  >
                    {busy === p.id ? "Opening checkout…" : isCurrent ? "Current plan" : lower ? "Included in your plan" : !p.purchasable ? "Coming soon" : currentPlan ? `Upgrade to ${p.label}` : `Get ${p.label}`}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-500">
            {error}
          </p>
        ) : null}
        <p className="mt-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">You pay on a secure Paystack page and come straight back. Credits don&apos;t carry over between days or weeks. Cancel any time from your usage page.</p>
      </div>
    </GlassSheetShell>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-2xl bg-background/70 px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-[18px] font-bold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-400")}>{value}</dd>
    </div>
  );
}

function Allowance({ label, value, light }: { label: string; value: number; light: boolean }) {
  return (
    <div className={cn("rounded-2xl px-3 py-2", light ? "bg-white/15" : "bg-secondary/60")}>
      <dt className={cn("text-[10px] font-semibold uppercase tracking-[0.08em]", light ? "text-white/75" : "text-muted-foreground")}>{label}</dt>
      <dd className="mt-0.5 text-[20px] font-bold leading-none tabular-nums">
        {value} <span className={cn("text-[11px] font-semibold", light ? "text-white/80" : "text-muted-foreground")}>credits</span>
      </dd>
    </div>
  );
}

/** "in 3 hours", "tomorrow", "in 4 days" — the reset, as a person says it. */
export function relative(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "shortly";
  const h = ms / 3_600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 24) return `in ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}
