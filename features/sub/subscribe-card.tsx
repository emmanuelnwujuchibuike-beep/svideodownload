"use client";

import { BadgeCheck, Check, Loader2, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { EX_CARD, exPrimary } from "@/features/sub/ui";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { offerView, type OfferMembership, type OfferQuote } from "@/lib/sub/offer";
import { durationLabel, savingsCents, savingsPercent, type SubOption } from "@/lib/sub/pricing";
import { cn } from "@/lib/utils";

/** What the card says about the 0277 option a member picked: the server's numbers, an honest saving, nothing invented. */
function optionLines(o: SubOption, monthlyTotal: number | null) {
  const perMonth = Math.round(o.totalCents / o.months);
  const saving = monthlyTotal && o.months > 1 ? savingsCents(o.totalCents, o.months, monthlyTotal) : 0;
  const pct = monthlyTotal && o.months > 1 ? savingsPercent(o.totalCents, o.months, monthlyTotal) : 0;
  return { perMonth, saving, pct, regularTotal: o.promotion ? o.regularTotalCents : null };
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });

/** The prepaid durations, as a radio list (0277). Shown only when there is more than the plain monthly option. */
function OptionPicker({ options, selected, onSelect }: { options: SubOption[]; selected: number; onSelect: (i: number) => void }) {
  // savings are against paying the REGULAR monthly total each month, never against a promotional month
  const monthlyTotal = options.find((o) => o.months === 1)?.regularTotalCents ?? null;
  return (
    <div role="radiogroup" aria-label="Choose how long" className="mt-3.5 flex flex-col gap-2">
      {options.map((o, i) => {
        const l = optionLines(o, monthlyTotal);
        const on = i === selected;
        return (
          <button
            key={`${o.months}-${o.promotion?.id ?? "regular"}`}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(i)}
            className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition", on ? "border-frenz-violet bg-frenz-violet/[0.06] ring-1 ring-frenz-violet" : "border-frenz-line bg-frenz-card")}
          >
            <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-frenz-violet" : "border-frenz-line")}>
              {on ? <span className="h-2.5 w-2.5 rounded-full bg-frenz-violet" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[15px] font-bold">{durationLabel(o.months)}</span>
                {l.pct > 0 ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Save {l.pct}%</span> : null}
                {o.promotion ? <span className="rounded-full bg-frenz-violet/10 px-2 py-0.5 text-[11.5px] font-bold text-frenz-violet">{o.promotion.name}</span> : null}
              </span>
              <span className="block text-[12.5px] text-frenz-muted">
                {o.months > 1 ? `${usd(l.perMonth)} a month · ` : ""}
                {o.periodDays} days
                {o.promotion ? ` · offer ends ${shortDay(o.promotion.endsAt)}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-heading text-[16px] font-bold tabular-nums">{usd(o.totalCents)}</span>
              {l.regularTotal && l.regularTotal > o.totalCents ? <s className="text-[12px] tabular-nums text-frenz-muted">{usd(l.regularTotal)}</s> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
  quote: (OfferQuote & { options?: SubOption[] }) | null;
  membership: OfferMembership | undefined;
  signedIn: boolean;
  returnPath: string;
}) {
  const v = offerView({ creatorName, quote, membership, signedIn });
  // 0277: the prepaid durations on offer; the picker shows only when there is more than the plain monthly price
  const options = quote?.options ?? [];
  const pickable = options.length > 1 || options.some((o) => o.promotion);
  const [selected, setSelected] = useState(() => Math.max(0, options.findIndex((o) => o.months === 1)));
  const chosen = pickable ? (options[selected] ?? null) : null;
  const choiceLine = chosen ? `${usd(chosen.totalCents)} for ${chosen.periodDays} days` : v.priceLine;
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
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId, returnPath, ...(chosen ? { months: chosen.months, promotionId: chosen.promotion?.id ?? null } : {}) }) }).catch(() => null);
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
        {v.action === "renew" && pickable ? <OptionPicker options={options} selected={selected} onSelect={setSelected} /> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {v.action === "renew" ? (
            <button type="button" onClick={() => void checkout()} disabled={busy} className={exPrimary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {busy ? "Opening secure payment…" : `${v.actionLabel}${choiceLine ? ` · ${choiceLine}` : ""}`}
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
      {pickable ? <OptionPicker options={options} selected={selected} onSelect={setSelected} /> : null}
      <div className="mt-4">
        {v.action === "sign_in" ? (
          <Link href={`/login?next=${encodeURIComponent(returnPath)}`} prefetch={false} className="flex min-h-[50px] w-full items-center justify-center rounded-full bg-frenz-gradient text-[15px] font-bold text-white">
            {v.actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={() => void checkout()} disabled={busy} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-frenz-gradient text-[15px] font-bold text-white transition active:scale-[0.99] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Opening secure payment…" : `${v.actionLabel}${choiceLine ? ` · ${choiceLine}` : ""}`}
          </button>
        )}
        {chosen ? (
          <p className="mt-2 text-center text-xs text-frenz-muted">{chosen.feeCents > 0 ? `${usd(chosen.priceCents)} to ${creatorName} + ${usd(chosen.feeCents)} service fee` : `All of it goes to ${creatorName}`}</p>
        ) : v.feeLine ? (
          <p className="mt-2 text-center text-xs text-frenz-muted">{v.feeLine}</p>
        ) : null}
        <p className="mt-1 text-center text-xs font-semibold text-frenz-ink">Paid once. Does not renew automatically.</p>
        <p className="mt-1 text-center text-xs text-frenz-muted">
          {(chosen?.periodDays ?? period) ? `One payment for ${chosen?.periodDays ?? period} days — you renew when you choose. ` : ""}Paid on a secure checkout; unlocks once the payment is confirmed.
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
