"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { formatMoney, type AdCatalog, type CatalogDuration } from "@/lib/ads-platform/offer";
import {
  nudgeTarget,
  presetTargets,
  sliderToTarget,
  snapTarget,
  targetProblem,
  targetRange,
  targetToSlider,
  discountedMinor,
  viewsDiscountPercent,
  viewsPriceMinor,
  type ViewsTerms,
} from "@/lib/ads-platform/views-pricing";
import { adMessage } from "@/lib/ads-platform/messages";
import { cn } from "@/lib/utils";

/**
 * Part 2 — "Choose Your Views": the target, the planned period, and what it
 * costs, all from the admin's live terms (ad_catalog). Every number here is an
 * ESTIMATE that follows ad_views_price_for rule for rule; nothing is sent while
 * the slider moves — the server prices the campaign at "Continue to Payment"
 * and the review shows the server's figure.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (n: number) => (n >= 1_000_000 ? `${fmt(n / 1_000_000)}M` : n >= 1000 ? `${fmt(n / 1000)}K` : fmt(n));

/**
 * The rates of the chosen placements — each placement is its own campaign at the same target,
 * each priced and discounted on its own (ad_views_price_for), so the sum here is the sum the
 * server charges. `discountPercent` is the volume discount (0246); 0 = the list price.
 */
export function viewsEstimate(target: number, rates: readonly number[], discountPercent = 0): number {
  return rates.reduce((sum, r) => sum + discountedMinor(viewsPriceMinor(target, r), discountPercent), 0);
}

/** "25% off" on a preset chip, from the admin's table — nothing when that size has no discount. */
export function presetDiscountLabel(terms: ViewsTerms, target: number): string | null {
  const pct = viewsDiscountPercent(terms, target);
  return pct > 0 ? `-${pct}%` : null;
}

/** The guarantee in the admin's actual terms — never a promise the settings don't make. */
export function guaranteeText(terms: ViewsTerms): string {
  if (terms.autoExtend && terms.maxExtensions > 0) {
    return "Your campaign is bought by views, not just by time. If the planned period ends before your target is reached, eligible delivery continues at no extra charge until it is.";
  }
  return "Your campaign is bought by views. If the planned period ends before your target is reached, delivery stops and the undelivered share of your payment is refunded.";
}

export function ViewsPicker({
  cat,
  terms,
  rates,
  placementNames,
  durations,
  target,
  durationId,
  onTarget,
  onDuration,
}: {
  cat: AdCatalog;
  terms: ViewsTerms;
  /** one rate per chosen placement (US cents per 1,000 views) */
  rates: readonly number[];
  placementNames: readonly string[];
  durations: readonly CatalogDuration[];
  target: number;
  durationId: string | null;
  onTarget: (n: number) => void;
  onDuration: (id: string) => void;
}) {
  const currency = cat.settings.display_currency;
  // 0246 (owner, 2026-10-15): a volume discount from the admin's table — 500K views 25%, 1M 30%
  const discount = viewsDiscountPercent(terms, target);
  const list = viewsEstimate(target, rates);
  const cost = viewsEstimate(target, rates, discount);
  const nextStep = (terms.discounts ?? []).find((d) => d.minViews > target && d.percent > discount && d.minViews <= terms.maxTarget) ?? null;
  const rate = rates.length === 1 ? rates[0]! : null;
  const period = durations.find((d) => d.id === durationId) ?? null;
  const { lo, hi } = targetRange(terms);

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div className="rounded-[1.6rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
        <p className="text-[13px] font-semibold text-muted-foreground">Target views</p>
        <div className="mt-3 flex gap-5">
          <VerticalSlider terms={terms} value={target} onChange={onTarget} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="font-brand text-[2.1rem] font-bold leading-none tracking-[-0.035em] tabular-nums" aria-hidden>
              {fmt(target)}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">qualifying views</p>
            <ExactInput terms={terms} value={target} onChange={onTarget} />
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Common sizes">
              {presetTargets(terms).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onTarget(p)}
                  aria-pressed={p === target}
                  className={cn(
                    "min-h-[2.25rem] rounded-full px-3 text-[12.5px] font-semibold tabular-nums ring-1 ring-inset transition-colors",
                    p === target ? "bg-indigo-600 text-white ring-indigo-600" : "bg-card text-foreground ring-black/[0.1] hover:ring-indigo-300 dark:ring-white/15",
                  )}
                >
                  {short(p)}
                  {presetDiscountLabel(terms, p) ? (
                    <span className={cn("ml-1 text-[10.5px] font-bold", p === target ? "text-white/85" : "text-emerald-600 dark:text-emerald-400")}>{presetDiscountLabel(terms, p)}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="mt-auto pt-3 text-[11.5px] text-muted-foreground">
              From {fmt(lo)} to {fmt(hi)} views{terms.step > 1 ? `, in steps of ${fmt(terms.step)}` : ""}.
            </p>
          </div>
        </div>

        <p className="mt-5 text-[13px] font-semibold text-muted-foreground">Planned delivery period</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Planned delivery period">
          {durations.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={d.id === durationId}
              onClick={() => onDuration(d.id)}
              className={cn(
                "min-h-[3rem] whitespace-nowrap rounded-2xl px-1.5 text-[13.5px] font-bold ring-1 ring-inset transition-[box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                d.id === durationId ? "ring-2 ring-indigo-500 shadow-[0_10px_24px_-18px_rgba(79,70,229,0.6)]" : "ring-black/[0.08] hover:ring-indigo-200 dark:ring-white/10",
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          The period you expect delivery in — not a fixed run. Your campaign stops as soon as the target is reached, even early.
        </p>
      </div>

      <aside aria-label="Your campaign" className="rounded-[1.6rem] bg-gradient-to-b from-indigo-50/80 to-card p-4 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/10 dark:to-card dark:ring-indigo-400/20">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-indigo-700 dark:text-indigo-300">Your campaign</p>
        <dl className="mt-3 space-y-2.5 text-[13.5px]">
          <SummaryLine label="Target reach" value={`${fmt(target)} views`} />
          <SummaryLine label="Price per 1,000 views" value={rate !== null ? formatMoney(rate, currency) : placementNames.map((n, i) => `${n} ${formatMoney(rates[i] ?? 0, currency)}`).join(" · ")} />
          <SummaryLine label="Planned period" value={period ? period.name : "Choose a period"} />
          <SummaryLine label="Placement" value={placementNames.join(" · ") || "—"} />
        </dl>
        {discount > 0 ? (
          <dl className="mt-3 space-y-1.5 border-t border-indigo-100 pt-3 text-[13px] dark:border-indigo-400/20">
            <SummaryLine label="Price" value={<span className="text-muted-foreground line-through">{formatMoney(list, currency)}</span>} />
            <SummaryLine label={`Volume discount (${discount}%)`} value={<span className="font-semibold text-emerald-600 dark:text-emerald-400">−{formatMoney(list - cost, currency)}</span>} />
          </dl>
        ) : null}
        <div className={cn("flex items-end justify-between pt-3", discount > 0 ? "mt-1.5" : "mt-3 border-t border-indigo-100 dark:border-indigo-400/20")}>
          <span className="text-[13px] font-semibold text-muted-foreground">Estimated cost</span>
          <span className="font-brand text-[1.7rem] font-bold leading-none tracking-[-0.03em] tabular-nums" aria-live="polite">
            {formatMoney(cost, currency)}
          </span>
        </div>
        {nextStep ? (
          <p className="mt-1.5 text-right text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">
            {nextStep.percent}% off from {short(nextStep.minViews)} views
          </p>
        ) : null}
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-card/80 p-3 text-[12.5px] leading-snug dark:bg-white/5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
          <span>
            <span className="font-semibold">Delivery protection. </span>
            {guaranteeText(terms)} It covers qualifying ad views — not clicks, sales or unique people.{" "}
            <Link href="/advertise/rules#views-delivery" target="_blank" rel="noopener" prefetch={false} className="font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
              Delivery terms
            </Link>
          </span>
        </div>
        {terms.minCheckoutMinor > 0 && cost < terms.minCheckoutMinor ? (
          <p className="mt-2 text-[12px] font-semibold text-amber-800 dark:text-amber-200" role="status">
            The smallest order is {formatMoney(terms.minCheckoutMinor, currency)} — choose more views.
          </p>
        ) : null}
        <p className="mt-2 text-[11.5px] text-muted-foreground">Final price confirmed before you pay.</p>
      </aside>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/**
 * The vertical slider: a real role="slider" (arrow keys, Page Up/Down, Home,
 * End), dragged with a pointer (mouse or touch, captured so the finger can
 * leave the track). Log scale so 1K and 1M are both a short reach. A drag
 * updates the parent at most once a frame — no request, no layout work.
 */
function VerticalSlider({ terms, value, onChange }: { terms: ViewsTerms; value: number; onChange: (n: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const { lo, hi } = targetRange(terms);
  const frac = targetToSlider(terms, value);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const emit = (n: number) => {
    pending.current = n;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current !== null) onChange(pending.current);
    });
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.height <= 0) return;
    emit(sliderToTarget(terms, (r.bottom - e.clientY) / r.height));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (e.key === "Home") onChange(lo);
    else if (e.key === "End") onChange(hi);
    else if (e.key in step) onChange(nudgeTarget(terms, value, step[e.key]!));
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col items-center">
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{short(hi)}</span>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Target views"
        aria-orientation="vertical"
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={value}
        aria-valuetext={`${fmt(value)} views`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        className="relative my-2 h-56 w-12 cursor-pointer touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <span className="absolute inset-x-[1.15rem] inset-y-2 rounded-full bg-secondary" aria-hidden />
        <span
          className="absolute inset-x-[1.15rem] bottom-2 rounded-full bg-gradient-to-t from-blue-500 via-indigo-500 to-violet-500"
          style={{ height: `calc((100% - 1rem) * ${frac})` }}
          aria-hidden
        />
        <span
          className="absolute left-1/2 h-7 w-7 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-[0_4px_14px_-4px_rgba(79,70,229,0.7)] ring-2 ring-indigo-500 dark:bg-slate-900"
          style={{ bottom: `calc(0.5rem + (100% - 1rem) * ${frac})` }}
          aria-hidden
        />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{short(lo)}</span>
    </div>
  );
}

/** The exact number: typed freely, applied on Enter or leaving the field, refused in plain words if it can't be bought. */
function ExactInput({ terms, value, onChange }: { terms: ViewsTerms; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setText(String(value));
    setProblem(null);
  }, [value]);
  const apply = () => {
    const digits = text.replace(/[,\s]/g, "");
    const n = /^[0-9]{1,9}$/.test(digits) ? Number(digits) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) return setProblem(adMessage("target_invalid"));
    const p = targetProblem(terms, n);
    if (p) {
      setProblem(adMessage(p, { min: terms.minTarget, max: terms.maxTarget, step: terms.step }));
      onChange(snapTarget(terms, n));
      return;
    }
    setProblem(null);
    onChange(n);
  };
  return (
    <div className="mt-3">
      <label htmlFor="ad-target-views" className="text-[12px] font-semibold text-muted-foreground">
        Exact number of views
      </label>
      <input
        id="ad-target-views"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        aria-invalid={!!problem}
        aria-describedby={problem ? "ad-target-views-error" : undefined}
        className="mt-1 h-11 w-full max-w-[12rem] rounded-xl bg-card px-3 text-[15px] tabular-nums ring-1 ring-inset ring-black/[0.1] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:ring-white/15"
      />
      {problem ? (
        <p id="ad-target-views-error" className="mt-1 text-[12px] font-medium text-rose-600 dark:text-rose-300">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
