"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GENERATION PRIMITIVES — cost, the button, progress, disclosure
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 §57 asks for a small reusable set and then says "Reuse existing
 * components when they are already good. Avoid component duplication." So this
 * file adds only what `ai-surface.tsx` does not have: the four pieces every
 * generation screen needs and no page had a shared version of.
 *
 * `ai-surface.tsx` stays the source of the LANGUAGE — the wash, the glass card,
 * the gradient pill, the headings. These are interactive, so they are client
 * components; the surface primitives are servers and must stay that way (a
 * `"use client"` there would drag every page that composes them across the
 * boundary, which this project has paid for before).
 *
 * ── 🔴 GLASS IS USED WHERE IT EARNS ITS PLACE (§4, §56) ────────────────────
 *
 * The brief is explicit that this must not become a glassmorphism demo: no
 * backdrop blur on body text, on every button, or across large areas. So the
 * only blurred surface here is the sticky cost/generate bar, which genuinely
 * floats over scrolling content and needs separation from it. The progress
 * panel and the disclosure are plain white with a hairline ring — cheaper to
 * paint and easier to read.
 */

/* ─────────────────────────────── the cost ────────────────────────────────── */

export interface AiCostProps {
  /** The SERVER's number, in minor units. Never computed in the browser (§55). */
  totalCents: number | null;
  currencySymbol: string;
  /** What the price is for, in the member's terms — "5s · 720p". */
  detail?: string | null;
  /** Which purse this will come out of (§20). */
  funding?: { label: string; hint?: string | null } | null;
  /** Shown while a fresh quote is in flight, so the number never looks stale. */
  loading?: boolean;
  /** A refusal the server gave instead of a price. */
  problem?: string | null;
}

/**
 * The price, before the member commits (§19).
 *
 * 🔴 It renders what the server said and nothing else. There is no arithmetic
 * in this component — not a multiplication, not a rounding — because a second
 * opinion about money that disagrees with the first is worse than no display.
 * While a new quote is loading the OLD number stays visible and dimmed rather
 * than disappearing, so the bar does not jump and the member is never briefly
 * shown nothing where a price was.
 */
export function AiCost({ totalCents, currencySymbol, detail, funding, loading, problem }: AiCostProps) {
  const money = totalCents === null ? null : `${currencySymbol}${(totalCents / 100).toFixed(2)}`;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-700/70">Estimated cost</span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-violet-500 motion-reduce:animate-none" aria-hidden /> : null}
      </div>
      {problem ? (
        <p className="mt-0.5 text-[13px] font-medium leading-snug text-rose-600">{problem}</p>
      ) : (
        <p className={cn("mt-0.5 text-[19px] font-bold leading-none tabular-nums tracking-[-0.02em]", loading && "opacity-55")}>
          {money ?? "—"}
          {detail ? <span className="ml-2 align-middle text-[12px] font-medium text-muted-foreground">{detail}</span> : null}
        </p>
      )}
      {funding ? (
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground/75">{funding.label}</span>
          {funding.hint ? ` · ${funding.hint}` : null}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── the generate button ───────────────────────── */

/**
 * The one unmistakable action (§21).
 *
 * 🔴 IT RESPONDS ON TOUCH, NOT ON NETWORK. `active:scale` is a CSS transition,
 * so the press is acknowledged in the same frame as the tap — §37 is explicit
 * that a member must never wonder whether their tap registered, and it is
 * equally explicit that the fix is not an artificial delay. The `busy` state
 * only replaces the LABEL; the visual press feedback is independent of it.
 *
 * `type="button"` on purpose: a submit inside a form is what produced the
 * recorded "dead first tap", where a pre-hydration tap became a native GET
 * submit and reloaded the page.
 */
export function AiGenerateButton({
  onClick,
  busy,
  disabled,
  children = "Generate",
  busyLabel = "Generating…",
  className,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  busyLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      className={cn(
        // 56px: the tap-target floor this project already holds AI actions to.
        "ai-cta inline-flex h-14 min-h-[3.5rem] shrink-0 items-center justify-center gap-2 px-7 text-[15px] font-bold",
        "transition-transform duration-100 active:scale-[0.97] motion-reduce:active:scale-100",
        "disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
    >
      {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="h-[18px] w-[18px]" aria-hidden />}
      {busy ? busyLabel : children}
    </button>
  );
}

/* ──────────────────────────── the sticky action bar ──────────────────────── */

/**
 * Cost on the left, Generate on the right, pinned above the fold on a phone.
 *
 * The one genuinely floating surface on a generation screen, so the one that
 * earns a backdrop blur (§4, §56). `pb-[env(safe-area-inset-bottom)]` keeps it
 * clear of the home indicator, and the bottom offset clears the app's own nav
 * bar so the two never overlap (§27).
 */
export function AiActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mt-6 lg:bottom-6",
        className,
      )}
    >
      <div className="flex items-center gap-3 rounded-[1.5rem] bg-white/80 px-4 py-3 ring-1 ring-inset ring-white/70 backdrop-blur shadow-[0_18px_50px_-28px_rgba(76,58,160,0.5)]">
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────────── progress ──────────────────────────────────── */

/**
 * What is happening, while it happens (§22).
 *
 * 🔴 NO FABRICATED PERCENTAGE. Kling reports `submitted` / `processing` /
 * `succeeded` / `failed` and nothing in between — there is no progress number
 * to show, so this renders an indeterminate bar. §22 says so directly, and
 * this project has a standing rule against displaying a statistic nobody
 * measured. A bar creeping to 90% and stopping is a lie that also teaches
 * members to distrust the real ones.
 *
 * The reassurance is the important copy: the job survives the page being
 * closed, and the member is notified. That is true — the callback, the
 * finalizer and the push all run server-side.
 */
export function AiGenerationStatus({ title, note, className }: { title: string; note?: string; className?: string }) {
  return (
    <div className={cn("rounded-[1.5rem] bg-white/80 p-5 ring-1 ring-inset ring-white/70", className)} role="status" aria-live="polite">
      <p className="text-[15px] font-bold tracking-[-0.015em]">{title}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-violet-100">
        {/* Indeterminate: a shuttle, not a value. `motion-reduce` stops it entirely (§63). */}
        <div className="ai-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 motion-reduce:w-full motion-reduce:animate-none" />
      </div>
      <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">
        {note ?? "You can leave this page — we'll notify you when it's ready."}
      </p>
    </div>
  );
}

/* ──────────────────────── progressive disclosure ─────────────────────────── */

/**
 * Advanced settings, closed by default (§17, §48).
 *
 * "Do not make advanced settings visually compete with the Generate button."
 * So this is a quiet row, not a card: no glass, no shadow, no accent — it has
 * to be findable and must not pull the eye away from the one action that
 * matters.
 *
 * A real `<button>` with `aria-expanded` and `aria-controls`, so a screen
 * reader and a keyboard get the same affordance as a pointer (§39).
 */
export function AiAdvancedSettings({ children, label = "Advanced settings", defaultOpen = false }: { children: ReactNode; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="mt-4 border-t border-black/[0.06] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-xl px-1 text-left text-[13.5px] font-semibold text-foreground/80 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {label}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="mt-3 space-y-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── a labelled control row ────────────────────────── */

/** A setting: its name, an optional note, and the control itself. */
export function AiField({ label, hint, children, htmlFor }: { label: string; hint?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold tracking-[-0.01em]">
        {label}
      </label>
      {hint ? <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * A segmented choice — duration, aspect ratio, quality.
 *
 * Buttons rather than a native `<select>`: the options are few and comparing
 * them at a glance is the point, and a 44px row is comfortably touchable (§38)
 * where a select's options are not. Selection is communicated by weight and
 * ground, never by colour alone (§39).
 */
export function AiSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[2.75rem] rounded-xl px-3.5 text-[13px] font-semibold transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
              "active:scale-[0.97] motion-reduce:active:scale-100",
              active ? "bg-foreground text-background shadow-[0_6px_18px_-10px_rgba(15,23,42,0.6)]" : "bg-white/70 text-foreground/75 ring-1 ring-inset ring-black/[0.06] hover:bg-white",
            )}
          >
            {o.label}
            {o.hint ? <span className={cn("ml-1.5 text-[11px] font-medium", active ? "text-background/70" : "text-muted-foreground")}>{o.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
