"use client";

import { useEffect, useState } from "react";

import type { TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * A "Pay with …" choice for the top-up and plan sheets, when a route offers
 * TWO configured providers. Since Bachs was removed (2026-10-17) Paystack is
 * the only provider, so nothing is drawn — kept for the next provider.
 *
 * The list is the server's (`/api/payments/options`, read once when a sheet
 * opens): the admin's route for this member's country, only providers that
 * are configured, in the route's order — the first is pre-selected. Fewer
 * than two → nothing is drawn and checkout behaves exactly as before. The
 * pick is a preference the checkout honours only among what it allows.
 *
 * Owner brief 2026-10-11: Paystack is RECOMMENDED for every top-up and deposit —
 * pre-selected and shown first with the label — and any other method sits
 * behind "More payment methods" until the member asks for it.
 */
export type PaymentProvider = TopupProviderId;
export interface PaymentOptionsView {
  walletTopup: PaymentProvider[];
  plans: Record<"ai_pro" | "ai_max", PaymentProvider[]>;
  /**
   * Nigeria only (2026-10-24): the two plan buttons and what each charges — "renew" (card, monthly subscription) and
   * "once" (one month in naira: bank transfer, USSD, card). null outside Nigeria. lib/payments/ng-plan-billing.ts.
   */
  ngBilling?: Record<"ai_pro" | "ai_max" | "pro" | "business", NgPlanButtons> | null;
  /** the edge's market ("NG" | "other") — the naira-only Paystack link shows in Nigeria alone */
  market?: "NG" | "other";
}
export interface NgPlanButtons {
  renew: { currency: string; amountMinor: number } | null;
  once: { currency: string; amountMinor: number } | null;
  /** Pro / Business: the 3-month bundle, paid once in naira (2026-10-24) */
  quarter?: { currency: string; amountMinor: number } | null;
}

/** A plan button's price: "₦16,300" / "$10.00" — the amount the checkout will charge. */
export function formatPlanPrice(p: { currency: string; amountMinor: number }): string {
  const major = p.amountMinor / 100;
  if (p.currency === "NGN") return `₦${Math.round(major).toLocaleString("en-US")}`;
  // 2026-10-26: the dollar sign was missing ("Card — 1.99/month")
  if (p.currency === "USD") return `$${major.toFixed(2)}`;
  if (p.currency === "GHS") return `GH₵${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p.currency === "KES") return `KSh ${Math.round(major).toLocaleString("en-US")}`;
  if (p.currency === "ZAR") return `R${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${p.currency} ${major.toFixed(2)}`;
}

/**
 * The one-off month button's name — what that currency's checkout actually offers (Flutterwave shows the methods of the
 * currency charged): naira = bank transfer / USSD; cedi / shilling = mobile money; rand = a local card.
 */
export function oncePayLabel(currency: string): string {
  if (currency === "NGN") return "Bank transfer / USSD";
  if (currency === "GHS") return "Mobile money / card";
  if (currency === "KES") return "M-Pesa / card";
  if (currency === "ZAR") return "Card in rand";
  return "Pay once";
}

const COPY: Record<PaymentProvider, { label: string; hint: string }> = {
  flutterwave: { label: "Flutterwave", hint: "Card, in US dollars" },
  paystack: { label: "Paystack", hint: "Card, bank, transfer" },
};

/** The route's first provider — the server orders them (Flutterwave first when it is enabled, owner 2026-10-23). */
export function defaultProvider(providers: PaymentProvider[]): PaymentProvider | null {
  return providers[0] ?? null;
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
  const recommended: PaymentProvider | null = providers[0] ?? null;
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
