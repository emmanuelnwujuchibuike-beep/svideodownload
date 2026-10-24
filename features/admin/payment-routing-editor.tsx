"use client";

import { PAYMENT_MARKETS, PAYMENT_PURPOSES, paymentRoutingProblem, type PaymentMarket, type PaymentPurpose, type PaymentRouting, type TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { cn } from "@/lib/utils";

/**
 * Part 5 — which provider takes a NEW checkout, per market and purpose (lib/payments/router.ts). Part of the AI Plans
 * card's state, saved by its Save (the one write path for `frenzAiPlans.wallet.routing`); the server refuses an unsafe
 * table (`paymentRoutingProblem`). Choosing Flutterwave here never switches it on: its capability gate (Admin →
 * Flutterwave: verified currency, enabled purposes, amount unit) still decides, and while it is shut the route is Paystack.
 */
const MARKET_LABEL: Record<PaymentMarket, string> = { NG: "Nigeria", other: "Everywhere else" };
const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  wallet_topup: "AI credit top-ups",
  ai_subscription: "AI Pro / Max plans",
  ad_campaign: "Ad campaigns",
  sub_purchase: "Creator subscriptions (SUB)",
  verification: "Paid verification",
  site_subscription: "Pro / Business plans",
};
type Choice = "flutterwave_paystack" | "paystack" | "paystack_flutterwave";
const CHOICES: { id: Choice; label: string }[] = [
  { id: "flutterwave_paystack", label: "Flutterwave → Paystack backup" },
  { id: "paystack", label: "Paystack only" },
  { id: "paystack_flutterwave", label: "Paystack → Flutterwave backup" },
];
const toChoice = (r: { primary: TopupProviderId; fallback: TopupProviderId | null }): Choice =>
  r.primary === "flutterwave" ? "flutterwave_paystack" : r.fallback === "flutterwave" ? "paystack_flutterwave" : "paystack";
const fromChoice = (c: Choice): { primary: TopupProviderId; fallback: TopupProviderId | null } =>
  c === "flutterwave_paystack" ? { primary: "flutterwave", fallback: "paystack" } : c === "paystack_flutterwave" ? { primary: "paystack", fallback: "flutterwave" } : { primary: "paystack", fallback: null };

export function PaymentRoutingEditor({ value, busy, onChange }: { value: PaymentRouting; busy: boolean; onChange: (next: PaymentRouting) => void }) {
  const problem = paymentRoutingProblem(value);
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Which provider opens a new checkout. A backup is tried only when the first one definitely refused before anything was
        created — never after a timeout. Choosing Flutterwave doesn&apos;t switch it on: until its currency, purposes and amount
        unit are confirmed in Admin → Flutterwave, these payments go to Paystack. Open payments always finish with the
        provider they started on.
      </p>
      {PAYMENT_MARKETS.map((m) => (
        <div key={m}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{MARKET_LABEL[m]}</h4>
          <div className="space-y-2">
            {PAYMENT_PURPOSES.map((p) => {
              const id = `routing-${m}-${p}`;
              return (
                <div key={p} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <label htmlFor={id} className="text-sm">
                    {PURPOSE_LABEL[p]}
                  </label>
                  <select
                    id={id}
                    value={toChoice(value[m][p])}
                    disabled={busy}
                    onChange={(e) => onChange({ ...value, [m]: { ...value[m], [p]: fromChoice(e.target.value as Choice) } })}
                    className={cn("h-9 w-full rounded-xl bg-background px-2 text-sm ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary sm:w-64", busy && "opacity-70")}
                  >
                    {CHOICES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {problem ? <p className="text-xs text-rose-500">{problem}</p> : null}
    </div>
  );
}
