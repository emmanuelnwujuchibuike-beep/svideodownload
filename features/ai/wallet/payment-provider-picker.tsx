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
  if (providers.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Pay with" className={cn("grid grid-cols-2 gap-2", className)}>
      {providers.map((p) => {
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
            <span className="text-[13.5px] font-bold">Pay with {COPY[p].label}</span>
            <span className={cn("text-[11px]", active ? "opacity-75" : light ? "text-white/75" : "text-muted-foreground")}>{COPY[p].hint}</span>
          </button>
        );
      })}
    </div>
  );
}
