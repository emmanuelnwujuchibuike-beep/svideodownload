"use client";

import { BadgeCheck, Check, Loader2, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { GLASS, primaryPill } from "@/features/friends/ui";
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

  const checkout = async () => {
    haptic("selection");
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId, returnPath }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.ok && j?.url) {
      window.location.assign(j.url);
      return;
    }
    setBusy(false);
    setNote(res?.status === 401 ? "Sign in again to subscribe." : (j?.error ?? "Couldn't open the payment. Nothing was charged. Try again."));
  };

  if (v.tone === "active") {
    return (
      <section aria-label="Your subscription" className={cn("mb-3 rounded-[22px] px-4 py-3.5", GLASS)}>
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
            <button type="button" onClick={() => void checkout()} disabled={busy} className={cn(primaryPill, "bg-gradient-to-r from-primary to-accent")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {busy ? "Opening secure payment…" : `${v.actionLabel}${v.priceLine ? ` · ${v.priceLine}` : ""}`}
            </button>
          ) : null}
          <Link href="/account/subscriptions" prefetch={false} className="text-[13px] font-semibold text-primary">
            Manage subscription
          </Link>
        </div>
        {note ? (
          <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-rose-500">
            {note}
          </p>
        ) : null}
      </section>
    );
  }

  if (v.tone === "unavailable") {
    return (
      <section aria-label="Subscriptions" className="mb-3 rounded-[22px] border border-border/70 px-4 py-3.5">
        <p className="text-[14px] font-semibold">{v.title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Check back later.</p>
      </section>
    );
  }

  return (
    <section aria-label={`Subscribe to ${creatorName}`} className={cn("mb-3 overflow-hidden rounded-[24px]", GLASS)}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.8)]">
          {v.tone === "expired" ? <RotateCcw className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-bold leading-tight tracking-[-0.01em]">{v.title}</p>
          {v.priceLine ? <p className="mt-1 text-[20px] font-extrabold leading-none tracking-[-0.02em]">{v.priceLine}</p> : null}
          {v.feeLine ? <p className="mt-1 text-[12px] text-muted-foreground">{v.feeLine}</p> : null}
          {v.status ? <p className="mt-1.5 text-[12.5px] font-medium text-muted-foreground">{v.status}</p> : null}
        </div>
      </div>
      <ul className="space-y-1.5 px-4 pt-3 text-[13px]">
        {["Every post they share with subscribers", "Like and comment on subscriber posts", "One payment — nothing renews automatically"].map((b) => (
          <li key={b} className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4 pt-3.5">
        {v.action === "sign_in" ? (
          <Link href={`/login?next=${encodeURIComponent(returnPath)}`} prefetch={false} className={cn(primaryPill, "w-full justify-center")}>
            {v.actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={() => void checkout()} disabled={busy} className={cn(primaryPill, "w-full justify-center bg-gradient-to-r from-primary to-accent")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Opening secure payment…" : v.actionLabel}
          </button>
        )}
        <p className="mt-2 text-center text-[11.5px] text-muted-foreground">Paid securely with Paystack. Unlocks once the payment is confirmed.</p>
        {note ? (
          <p role="alert" className="mt-1.5 text-center text-[12.5px] font-medium text-rose-500">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
