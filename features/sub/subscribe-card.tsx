"use client";

import { BadgeCheck, Check, Loader2, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { EX_CARD, exPrimary } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import { offerView, type OfferMembership, type OfferQuote } from "@/lib/sub/offer";
import { cn } from "@/lib/utils";

/**
 * The creator subscription card (Frenz Exclusive Part 4) — ONE per profile tab, replacing the
 * old notice, price box and "You're subscribed" banner. What it says comes from `offerView`
 * (lib/sub/offer.ts): the server's price + fee, the visitor's own membership, no invented numbers.
 * Subscribe and Renew go to the existing /api/sub/checkout, which recomputes the price on the
 * server; the browser sends only who to subscribe to and where to come back.
 */
export function CreatorSubscribeCard({
  creatorId,
  creatorName,
  quote,
  membership,
  signedIn,
  returnPath,
}: {
  creatorId: string;
  creatorName: string;
  quote: OfferQuote | null;
  membership: OfferMembership | undefined;
  signedIn: boolean;
  returnPath: string;
}) {
  const v = offerView({ creatorName, quote, membership, signedIn });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Part 4: a synchronous latch — two taps in the same frame (before "busy" re-renders the button) start ONE checkout
  const starting = useRef(false);

  const checkout = async () => {
    if (starting.current) return;
    starting.current = true;
    haptic("selection");
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId, returnPath }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.ok && j?.url) {
      window.location.assign(j.url);
      return;
    }
    starting.current = false;
    setBusy(false);
    setNote(res?.status === 401 ? "Sign in again to subscribe." : (j?.error ?? "Couldn't open the payment. Nothing was charged. Try again."));
  };

  if (v.tone === "active") {
    return (
      <section aria-label="Your subscription" className={cn("mb-3 rounded-[22px] px-4 py-3.5", EX_CARD)}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <BadgeCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight">{v.title}</p>
            {v.status ? <p className="mt-0.5 text-[13px] text-muted-foreground">{v.status}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {v.action === "renew" ? (
            <button type="button" onClick={() => void checkout()} disabled={busy} className={exPrimary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {busy ? "Opening secure payment…" : `${v.actionLabel}${v.priceLine ? ` · ${v.priceLine}` : ""}`}
            </button>
          ) : null}
          <Link href="/account/subscriptions" prefetch={false} className="text-[13px] font-semibold text-primary">
            Manage subscription
          </Link>
        </div>
        {note ? (
          <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
            {note}
          </p>
        ) : null}
      </section>
    );
  }

  if (v.tone === "unavailable") {
    return (
      <section aria-label="Subscriptions" className="ex-card mb-3 px-4 py-3.5">
        <p className="text-[14px] font-semibold">{v.title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Check back later.</p>
      </section>
    );
  }

  /*
    design/Exclusive.dc.html (owner, 2026-10-18): "Unlock exclusive posts", what's included, and
    "Subscribe · [price]" on the existing checkout, with the creator's real price and period. The
    design's "[Renewal & cancellation terms]" is our real terms: one payment for the period, nothing
    renews automatically (lib/sub/offer.ts, Part 5), paid with Paystack.
  */
  const period = quote?.periodDays ?? null;
  return (
    <section id="sub-offer" aria-label={`Subscribe to ${creatorName}`} className="frenz-ui mb-4 rounded-[24px] border border-frenz-line bg-frenz-card p-4 text-frenz-ink shadow-frenz-card">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
          {v.tone === "expired" ? <RotateCcw className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 font-heading text-lg font-bold">{v.tone === "expired" ? v.title : "Unlock exclusive posts"}</h2>
          <p className="m-0 text-[13px] text-frenz-muted">{v.tone === "expired" && v.status ? v.status : `Subscriber-only content from ${creatorName}`}</p>
        </div>
      </div>
      <ul className="mt-3.5 flex flex-col gap-2.5">
        {["Every post they share with subscribers", "Like and comment on subscriber posts", "One payment — nothing renews automatically"].map((b) => (
          <li key={b} className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-frenz-violet/10 text-frenz-violet">
              <Check className="h-3.5 w-3.5" />
            </span>
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {v.action === "sign_in" ? (
          <Link href={`/login?next=${encodeURIComponent(returnPath)}`} prefetch={false} className="flex min-h-[50px] w-full items-center justify-center rounded-full bg-frenz-gradient text-[15px] font-bold text-white">
            {v.actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={() => void checkout()} disabled={busy} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-frenz-gradient text-[15px] font-bold text-white transition active:scale-[0.99] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Opening secure payment…" : `${v.actionLabel}${v.priceLine ? ` · ${v.priceLine}` : ""}`}
          </button>
        )}
        {v.feeLine ? <p className="mt-2 text-center text-xs text-frenz-muted">{v.feeLine}</p> : null}
        <p className="mt-1 text-center text-xs text-frenz-muted">
          {period ? `One payment for ${period} days. Nothing renews automatically — you renew when you choose. ` : ""}Paid on a secure checkout; unlocks once the payment is confirmed.
        </p>
        {note ? (
          <p role="alert" className="mt-1.5 text-center text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
