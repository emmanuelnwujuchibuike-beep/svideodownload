"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useUser } from "@/features/auth/use-user";
import { formatPlanPrice, usePaymentOptions } from "@/features/ai/wallet/payment-provider-picker";

/**
 * Starts a subscription upgrade. Anyone can click it (signed in or not):
 * - not signed in → straight to sign-up (with a return to /pricing), no waiting
 *   on a billing call first;
 * - signed in → checkout: Flutterwave (USD, card) first, Paystack the backup (2026-10-23). The small link
 *   underneath asks for Paystack (NGN) — bank transfer or USSD, which Flutterwave payment plans cannot take.
 * - signed in, in NIGERIA (2026-10-24): two buttons with their prices — "Card — ₦…/month" (a Flutterwave subscription
 *   that renews) and "Bank transfer / USSD — ₦…" (one month paid once in naira). lib/payments/ng-plan-billing.ts.
 */
export function UpgradeButton({
  plan,
  className,
  children,
}: {
  plan: "pro" | "business";
  className?: string;
  children: React.ReactNode;
}) {
  const { user, enabled } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the Nigerian two-button prices: read only for a signed-in member (one request, when the button mounts)
  const options = usePaymentOptions(!!user);
  const ng = options?.ngBilling?.[plan];
  const ngButtons = ng && (ng.renew || ng.once || ng.quarter) ? ng : null;

  const go = async (provider?: "paystack", billing?: "renew" | "once" | "quarter") => {
    // Anonymous → sign up immediately, then come back to pricing.
    if (enabled && !user) {
      window.location.href = `/login?signup=1&next=${encodeURIComponent("/pricing")}`;
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, ...(provider ? { provider } : {}), ...(billing ? { billing } : {}) }),
      });
      const json = await res.json();
      if (res.status === 401 && json.login) {
        window.location.href = `/login?signup=1&next=${encodeURIComponent("/pricing")}`;
        return;
      }
      if (json.url) {
        window.location.href = json.url as string;
        return;
      }
      setError(json.error ?? "Couldn't start checkout.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (user && ngButtons) {
    return (
      <>
        {ngButtons.renew ? (
          <button type="button" onClick={() => go(undefined, "renew")} disabled={loading} className={className}>
            {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <>Card — {formatPlanPrice(ngButtons.renew)}/month<span className="block text-[11px] font-medium opacity-80">Renews monthly · cancel anytime</span></>}
          </button>
        ) : null}
        {ngButtons.once ? (
          <button type="button" onClick={() => go(undefined, "once")} disabled={loading} className={ngButtons.renew ? "mt-2 block w-full rounded-xl border border-border px-3 py-2.5 text-center text-sm font-semibold transition hover:bg-secondary disabled:opacity-60" : className}>
            Bank transfer / USSD — {formatPlanPrice(ngButtons.once)}
            <span className="block text-[11px] font-medium text-muted-foreground">1 month · doesn&apos;t renew</span>
          </button>
        ) : null}
        {ngButtons.quarter ? (
          <button type="button" onClick={() => go(undefined, "quarter")} disabled={loading} className="mt-2 block w-full rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5 text-center text-sm font-semibold transition hover:bg-primary/10 disabled:opacity-60">
            3 months — {formatPlanPrice(ngButtons.quarter)}
            <span className="block text-[11px] font-medium text-muted-foreground">Paid once · bank transfer, USSD or card · doesn&apos;t renew</span>
          </button>
        ) : null}
        {error ? <p className="mt-2 text-center text-xs text-red-400">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      <button type="button" onClick={() => go()} disabled={loading} className={className}>
        {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : children}
      </button>
      {user ? (
        <button type="button" onClick={() => go("paystack")} disabled={loading} className="mt-2 block w-full text-center text-xs text-muted-foreground underline">
          Pay by bank transfer or USSD (NGN)
        </button>
      ) : null}
      {error ? <p className="mt-2 text-center text-xs text-red-400">{error}</p> : null}
    </>
  );
}
