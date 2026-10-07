"use client";

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { formatCredits } from "@/lib/ai/credits/units";
import { formatCents } from "@/lib/ai/economy";
import { PaymentProviderPicker, usePaymentOptions, type PaymentProvider } from "@/features/ai/wallet/payment-provider-picker";
import { beginAiWalletTopup, type AiWalletBalance } from "@/lib/ai/wallet/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The sheet is the product's own (framer-motion inside), and it is fetched
  only when Recharge is pressed — the same split the AI dashboard uses, for
  the same reason: the workspace must not carry a sheet nobody has opened.
*/
const GlassSheetShell = dynamic(() => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell), {
  ssr: false,
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RECHARGE — the operator's packages, a custom amount, and Paystack
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §17): "Recharge packages: ₦500, ₦1,000,
 * ₦2,500, ₦5,000, ₦10,000, custom amount… The recharge UI should be clean and
 * premium." The packages and the bounds come with the balance from the
 * server (`/api/ai/character-replace/balance`), never from a constant here.
 *
 * Opened from two places — the balance card's Recharge, and the insufficient
 * panel's — which is why it is its own component with an `open` the step
 * owns. Whichever amount is chosen, the server re-checks it against the same
 * bounds and answers with Paystack's page (§11: nothing here moves money).
 *
 * ── 🔴 MOVED HERE 2026-09-27, AND WHY ───────────────────────────────────────
 * Owner: "text to audio shouldnt go through character replace, character
 * replace should work alone." This sheet recharges the ONE Frenz AI balance
 * that every paid tool spends — it was never Character Replace's — so living
 * in that folder made one tool a dependency of every other. One sheet, one
 * Paystack call, a neutral home. `features/ai/character-replace/recharge-sheet`
 * is a re-export so nothing that already imports it had to change.
 *
 * A preset is SELECTED first and confirmed with one button, so a tap on the
 * wrong figure is a tap away from fixing, not a navigation to a payment page.
 * A custom amount types into the same confirm.
 *
 * ── 🔴 CREDITS, NOT DOLLARS (0184, owner 2026-10-07) ────────────────────────
 * The member buys CREDIT PACKS: "100 credits · $10.00". The packs, their
 * bonuses, their USD prices and the custom bounds are the operator's
 * (`frenzAiPlans.wallet`, sent as `balance.offer`); the price shown is the
 * server's `priceUsdCents`. The checkout page shows what it collects in its
 * own currency.
 */
export function AiWalletRechargeSheet({
  open,
  onClose,
  balance,
  returnTo,
  /** How many credits the member is short by, if they came here from a "not enough credits" panel. */
  suggestedCredits = null,
}: {
  open: boolean;
  onClose: () => void;
  balance: AiWalletBalance;
  returnTo: string;
  suggestedCredits?: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  // 2026-10-07: Paystack or Bachs, when the admin lets members choose and both are live here
  const options = usePaymentOptions(open);
  const providers = options?.walletTopup ?? [];
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const chosen = provider && providers.includes(provider) ? provider : (providers[0] ?? null);
  const offer = balance.offer;
  const packs = offer.packs;

  /*
    Coming from "Short by 40 credits": the smallest pack that covers it is
    pre-selected, so the obvious next tap is the right one. Otherwise the
    operator's highlighted pack is, and the member may pick another.
  */
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (suggestedCredits !== null && suggestedCredits > 0) {
      const covering = packs.find((p) => p.credits + p.bonusCredits >= suggestedCredits) ?? null;
      setSelected(covering?.id ?? null);
      setCustom(covering === null && offer.custom ? String(Math.max(suggestedCredits, offer.custom.minCredits)) : "");
    } else {
      setSelected(packs.find((p) => p.highlight)?.id ?? null);
      setCustom("");
    }
  }, [open, suggestedCredits, packs, offer.custom]);

  const pack = packs.find((p) => p.id === selected) ?? null;
  const customCredits = custom.trim() === "" ? null : Number(custom);
  const customValid = !pack && offer.custom !== null && customCredits !== null && Number.isInteger(customCredits) && customCredits >= offer.custom.minCredits && customCredits <= offer.custom.maxCredits;
  const priceUsdCents = pack ? pack.priceUsdCents : customValid && customCredits !== null ? customCredits * offer.centsPerCredit : null;
  const ready = pack !== null || customValid;

  const confirm = useCallback(async () => {
    if (!ready) return;
    haptic("selection");
    setBusy(true);
    setError(null);
    const res = await beginAiWalletTopup(pack ? { packId: pack.id } : { credits: customCredits ?? 0 }, returnTo, providers.length > 1 ? chosen : null);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    // A full navigation to the hosted payment page — never a popup.
    window.location.assign(res.url);
  }, [ready, pack, customCredits, returnTo, providers.length, chosen]);

  return (
    <GlassSheetShell open={open} onClose={onClose} title="Top up credits" fitContent defaultHeightVh={78}>
      <div className="px-4 pb-6">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Credits pay for every Frenz AI tool. You&apos;ll pay on a secure page and come straight back here.
        </p>

        {suggestedCredits !== null && suggestedCredits > 0 ? (
          <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5 text-[12.5px] leading-relaxed">
            You need <strong className="font-bold tabular-nums">{formatCredits(suggestedCredits)}</strong> more for this.
          </p>
        ) : null}

        <div role="radiogroup" aria-label="Credit pack" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {packs.map((p) => {
            const active = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => {
                  haptic("selection");
                  setSelected(p.id);
                  setCustom("");
                }}
                className={cn(
                  "relative flex min-h-[64px] flex-col items-center justify-center rounded-2xl border px-2 transition active:scale-[0.97] disabled:opacity-60",
                  active
                    ? "border-foreground bg-foreground text-background shadow-[0_10px_24px_-14px_rgb(0_0_0/0.6)]"
                    : "border-border/70 bg-background hover:border-foreground/25",
                )}
              >
                <span className="text-[15px] font-bold tabular-nums">{formatCredits(p.credits)}</span>
                <span className={cn("text-[11.5px] font-semibold tabular-nums", active ? "text-background/75" : "text-muted-foreground")}>
                  {formatCents(p.priceUsdCents, "$")}
                  {p.bonusCredits > 0 ? ` · +${p.bonusCredits.toLocaleString("en-US")} bonus` : ""}
                </span>
                {active ? (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-background/20">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {offer.custom ? (
          <>
            <label className="relative mt-3 block">
              <span className="sr-only">Custom number of credits</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Custom number of credits"
                value={custom}
                disabled={busy}
                onChange={(e) => {
                  setCustom(e.target.value.replace(/[^\d]/g, ""));
                  setSelected(null);
                }}
                className={cn(
                  "h-[56px] w-full rounded-2xl border bg-background px-4 text-[15px] font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected === null && custom !== "" ? "border-foreground" : "border-border/70",
                )}
              />
            </label>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              From {formatCredits(offer.custom.minCredits)} to {formatCredits(offer.custom.maxCredits)} · {formatCents(offer.centsPerCredit, "$")} per credit.
            </p>
          </>
        ) : null}
        {balance.checkout && ready ? (
          /* Owner, 2026-09-20 (evening): no rate arithmetic here — the secure checkout page shows the amount it collects. */
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground" aria-live="polite">
            Priced in {balance.currency}; the secure page shows what you pay in {balance.checkout.currency}.
          </p>
        ) : null}

        <PaymentProviderPicker providers={providers} value={chosen} onChange={setProvider} disabled={busy} className="mt-4" />

        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void confirm()}
          className={cn(
            "mt-4 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold text-white",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)]",
            "transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
          )}
        >
          {busy ? "Opening secure payment…" : ready && priceUsdCents !== null ? `Pay ${formatCents(priceUsdCents, "$")}` : "Choose a pack"}
        </button>

        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-500">
            {error}
          </p>
        ) : null}
      </div>
    </GlassSheetShell>
  );
}
