"use client";

import { useEffect, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * "Pay with Paystack / Pay with Bachs" — shown in the top-up and plan sheets
 * (owner, 2026-10-07: "checkout doesn't show to choose Paystack or Bachs").
 *
 * The list is the server's (`/api/payments/options`, read once when a sheet
 * opens): the admin's route for this member's country, only providers that
 * are configured, in the route's order — the first is pre-selected. Fewer
 * than two → nothing is drawn and checkout behaves exactly as before. The
 * pick is a preference the checkout honours only among what it allows.
 *
 * Owner brief 2026-10-11: Paystack is RECOMMENDED for every top-up and deposit —
 * pre-selected and shown first with the label — and any other method (Bachs)
 * sits behind "More payment methods" until the member asks for it.
 */
export type PaymentProvider = "paystack" | "bachs";
export interface PaymentOptionsView {
  walletTopup: PaymentProvider[];
  plans: Record<"ai_pro" | "ai_max", PaymentProvider[]>;
}

const COPY: Record<PaymentProvider, { label: string; hint: string }> = {
  paystack: { label: "Paystack", hint: "Card, bank, transfer" },
  bachs: { label: "Bachs", hint: "Card, bank, transfer" },
};

/** Paystack when the route allows it (the recommended method), else the route's first. */
export function defaultProvider(providers: PaymentProvider[]): PaymentProvider | null {
  return providers.includes("paystack") ? "paystack" : (providers[0] ?? null);
}

/** One read per sheet opening; null until it answers (or if it cannot — then no picker, the server routes). */
export function usePaymentOptions(open: boolean): PaymentOptionsView | null {
  const [options, setOptions] = useState<PaymentOptionsView | null>(null);
  useEffect(() => {
    if (!open || options) return;
    let live = true;
    fetch("/api/payments/options", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<PaymentOptionsView>) : null))
      .then((o) => {
        if (live && o) setOptions(o);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, options]);
  return options;
}

export function PaymentProviderPicker({ providers, value, onChange, disabled, light = false, className }: { providers: PaymentProvider[]; value: PaymentProvider | null; onChange: (p: PaymentProvider) => void; disabled?: boolean; light?: boolean; className?: string }) {
  const recommended: PaymentProvider | null = providers.includes("paystack") ? "paystack" : null;
  const [more, setMore] = useState(false);
  if (providers.length < 2) return null;
  const others = providers.filter((p) => p !== recommended);
  // another method stays visible once it is the one chosen
  const showOthers = !recommended || more || (value !== null && value !== recommended);
  const shown = recommended ? [recommended, ...(showOthers ? others : [])] : providers;
  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Pay with" className="grid grid-cols-1 gap-2">
        {shown.map((p) => {
          const active = value === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                haptic("selection");
                onChange(p);
              }}
              className={cn(
                "flex min-h-[48px] flex-col items-start justify-center rounded-2xl border px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                light
                  ? active
                    ? "border-white bg-white text-indigo-700"
                    : "border-white/40 text-white"
                  : active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 bg-background hover:border-foreground/25",
              )}
            >
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13.5px] font-bold">
                Pay with {COPY[p].label}
                {p === recommended ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", active ? (light ? "bg-indigo-600 text-white" : "bg-background/20") : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>Recommended</span> : null}
              </span>
              <span className={cn("text-[11px]", active ? "opacity-75" : light ? "text-white/75" : "text-muted-foreground")}>{COPY[p].hint}</span>
            </button>
          );
        })}
      </div>
      {recommended && others.length && !showOthers ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            haptic("selection");
            setMore(true);
          }}
          className={cn("mt-1.5 min-h-[2.25rem] text-[12.5px] font-semibold underline-offset-2 hover:underline", light ? "text-white/85" : "text-muted-foreground")}
        >
          More payment methods
        </button>
      ) : null}
    </div>
  );
}
