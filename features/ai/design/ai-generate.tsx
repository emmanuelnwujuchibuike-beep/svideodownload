"use client";

import { ArrowRight, ChevronDown, ChevronRight, Loader2, Sparkles, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { aiButtonClass } from "@/features/ai/design/ai-button";
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
    <div className="min-w-0 shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="whitespace-nowrap text-[11.5px] font-semibold text-violet-700/80">Estimated cost</span>
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
      /*
        Redesign page 3 (owner's reference, 2026-10-05): the shared primary —
        a full pill in the reference's blue → violet → pink, STATIC. This was
        `.ai-cta`, whose gradient ran a 9 s pass forever (paused only by the
        environment's --ai-play). The reference button does not move, so
        nothing here animates except the spinner while it is busy.
        56 px: the tap-target floor this project already holds AI actions to.
      */
      className={cn(aiButtonClass({ size: "lg", className: "min-h-[3.5rem] shrink-0 px-6" }), className)}
    >
      {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="h-[18px] w-[18px]" aria-hidden />}
      <span className="truncate">{busy ? busyLabel : children}</span>
      {busy ? null : (
        <span className="ai-btn__icon-end flex" aria-hidden>
          <ArrowRight className="h-[18px] w-[18px]" />
        </span>
      )}
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
      {/*
        Page 3: lighter. A hairline edge and a small shadow instead of a white
        glow ring and a 50 px violet bloom; the glass stays (it rides over the
        page while it scrolls, the one place a blur earns its cost).
      */}
      <div className="flex items-center gap-3 ai-glass ai-glass--bar rounded-[1.75rem] py-2.5 pl-4 pr-2.5 ring-1 ring-inset ring-black/[0.07] shadow-[0_10px_28px_-18px_rgba(30,40,90,0.4)]">
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

/* ──────────────────────── the setting row (redesign page 3) ───────────────── */

/**
 * "Duration · 5 seconds ›" — a setting as one tappable row, from the owner's
 * reference (2026-10-05): an icon tile, the label, the current value, a
 * chevron.
 *
 * 🔴 The control underneath is a NATIVE `<select>` stretched over the row and
 * made transparent. A tap opens the platform's own picker — the iOS wheel, the
 * Android sheet — which is the most native-feeling chooser a web page can
 * offer, is fully accessible (the select carries the label), and costs no JS:
 * no sheet component, no popover, no focus trap of our own.
 */
export function AiSettingRow<T extends string>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div
      className={cn(
        "relative flex min-h-[3.75rem] items-center gap-2.5 rounded-2xl bg-card px-2.5 ring-1 ring-inset ring-black/[0.07] transition dark:ring-white/10 min-[400px]:gap-3 min-[400px]:px-3",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring [@media(hover:hover)]:hover:ring-indigo-300/60",
        disabled && "opacity-55",
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 min-[400px]:h-9 min-[400px]:w-9">
        <Icon className="h-[17px] w-[17px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-l`} className="block truncate text-[13.5px] font-semibold leading-tight">{label}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{current}</span>
      </span>
      {/* hidden on the narrowest phones: the whole row is the control, and the label needs the room */}
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground min-[400px]:block" aria-hidden />
      <select
        aria-labelledby={`${id}-l`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-2xl opacity-0 disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ─────────────────────── the prompt box (redesign page 3) ─────────────────── */

/**
 * "Describe your video" — the reference's prompt: a bold label and hint, an
 * inset field, the counter INSIDE the field's corner. The field is the
 * visually important thing on the screen, so it is the one inset surface;
 * everything around it stays flat.
 */
export function AiPromptBox({
  label,
  hint,
  value,
  onChange,
  max,
  placeholder,
  rows = 4,
  disabled,
  aside,
}: {
  label: string;
  hint?: string | null;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** Top-right of the label row (the reference's sparkle button goes here when a tool has one). */
  aside?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-[15px] font-bold tracking-[-0.015em]">
            {label}
          </label>
          {hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
        {aside}
      </div>
      <div className="relative mt-3 rounded-2xl bg-card ring-1 ring-inset ring-black/[0.08] transition focus-within:ring-2 focus-within:ring-indigo-400 dark:ring-white/10">
        <textarea
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.slice(0, max))}
          rows={rows}
          placeholder={placeholder}
          className="block w-full resize-y rounded-2xl border-0 bg-transparent px-4 pb-8 pt-3.5 text-[15px] leading-relaxed placeholder:text-muted-foreground/75 focus-visible:outline-none"
        />
        <span className="pointer-events-none absolute bottom-2.5 right-3.5 text-[11.5px] tabular-nums text-muted-foreground" aria-live="off">
          {value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────── the style picker (redesign page 3) ───────────────── */

export interface AiStyleOption<T extends string> {
  value: T;
  label: string;
  /** The tile's picture — a small pre-sized webp in /public/ai/styles (~6–11 kB). */
  image: string;
}

/**
 * "Video Style" — the reference's row of picture tiles (owner, 2026-10-05:
 * "make everything identical to the reference image"; the four pictures are
 * the owner's own, the realistic one from the curated wallpaper library).
 *
 *   [◫] Video Style                                   ›
 *       Realistic
 *   [ picture ] [ picture ] [ picture ] [ picture ]
 *    Realistic     Anime      Cartoon       3D
 *
 * The chosen tile sits in a soft box with a blue → violet gradient edge and
 * a bold label, as in the reference.
 *
 * Optional, and NOTHING is selected by default: the model takes its style
 * from the prompt, so the picker's only effect is to add the chosen style to
 * what is sent (lib/ai/video/style.ts). A member who never touches it gets
 * exactly what they got before. Tapping the selected tile again clears it.
 *
 * The pictures are plain <img> at a fixed size (no layout shift), lazy, and
 * already the right size — no image optimizer, no request to our servers.
 */
export function AiStylePicker<T extends string>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  value: T | null;
  options: readonly AiStyleOption<T>[];
  onChange: (v: T | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const current = options.find((o) => o.value === value)?.label ?? "Any style, from your description";
  return (
    <div className="rounded-2xl bg-card px-3 pb-3 pt-2.5 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span id={`${id}-l`} className="block text-[13.5px] font-semibold leading-tight">{label}</span>
          <span className="mt-0.5 block truncate text-[13px] text-foreground/75">{current}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-l`}
        className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] min-[360px]:grid min-[360px]:grid-cols-4 min-[360px]:overflow-visible"
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(on ? null : o.value)}
              className={cn(
                "w-[5.5rem] shrink-0 rounded-[1rem] p-[1.5px] text-center transition active:scale-[0.97] motion-reduce:active:scale-100 min-[360px]:w-auto",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-gradient-to-br from-sky-300 via-indigo-300 to-violet-400 shadow-[0_6px_16px_-10px_rgba(99,102,241,0.6)]" : "bg-transparent",
              )}
            >
              <span className={cn("block rounded-[0.9rem] p-1", on ? "bg-[#f4f5ff]" : "")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a 264×152 webp already at its display size */}
                <img
                  src={o.image}
                  alt=""
                  width={264}
                  height={152}
                  loading="lazy"
                  decoding="async"
                  className="block aspect-[264/152] w-full rounded-[0.75rem] object-cover"
                />
                <span className={cn("mt-1 block truncate text-[12px] leading-tight", on ? "font-semibold text-foreground" : "text-foreground/75")}>
                  {o.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
