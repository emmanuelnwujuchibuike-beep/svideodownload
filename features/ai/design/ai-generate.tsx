"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode, type Ref } from "react";

import { AiCreditsChip } from "@/features/ai/design/ai-welcome-parts";
import { formatCredits } from "@/lib/ai/credits/units";
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
  /** The SERVER's number, in CREDITS (0184). Never computed in the browser (§55). */
  credits: number | null;
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
export function AiCost({ credits, detail, funding, loading, problem }: AiCostProps) {
  const money = credits === null ? null : credits === 0 ? "Free" : formatCredits(credits);
  return (
    <div className="min-w-0 shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="whitespace-nowrap text-[12px] font-semibold text-frenz-muted">Estimated cost</span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-frenz-violet motion-reduce:animate-none" aria-hidden /> : null}
      </div>
      {problem ? (
        <p className="m-0 mt-0.5 text-[13px] font-semibold leading-snug text-rose-600 dark:text-rose-400">{problem}</p>
      ) : (
        <p className={cn("m-0 mt-0.5 font-heading text-[18px] font-bold leading-none tabular-nums text-frenz-ink", loading && "opacity-55")}>
          {/* "—" until the server has priced it (step 18: never a guessed number) */}
          {money ?? "—"}
          {detail ? <span className="ml-2 align-middle font-body text-[12px] font-medium text-frenz-muted">{detail}</span> : null}
        </p>
      )}
      {funding ? (
        <p className="m-0 mt-1 text-[11.5px] leading-snug text-frenz-muted">
          <span className="font-semibold text-frenz-ink/80">{funding.label}</span>
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
      // the page's one primary action: the brand gradient, static, 56 px (step 18, design/TextToVideo.dc.html)
      className={cn(
        "inline-flex min-h-[3.5rem] shrink-0 items-center justify-center gap-2 rounded-full bg-frenz-gradient-x px-6 font-heading text-[16px] font-bold text-white shadow-frenz-card transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 disabled:opacity-45 motion-reduce:active:scale-100",
        className,
      )}
    >
      {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      <span className="truncate">{busy ? busyLabel : children}</span>
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
export function AiActionBar({ children, className, docked = false }: { children: ReactNode; className?: string; /** The creation screens (steps 18–19): the bottom nav is hidden there, so the bar takes the bottom edge. */ docked?: boolean }) {
  return (
    <div
      className={cn(
        "sticky z-20 mt-6",
        docked ? "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6",
        className,
      )}
    >
      {/*
        The one floating surface on a generation screen, so the one that earns glass. On the creation screens
        it is the design's white glass bar (the nav's own tiers: solid when transparency is reduced).
      */}
      <div
        className={cn(
          "flex items-center gap-3",
          docked
            ? "frenz-nav-glass frenz-nav-glass--static rounded-[26px] py-2 pl-4 pr-2"
            : "ai-glass ai-glass--bar rounded-[1.75rem] py-2.5 pl-4 pr-2.5 ring-1 ring-inset ring-black/[0.07] shadow-[0_10px_28px_-18px_rgba(30,40,90,0.4)]",
        )}
      >
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
  // step 18: a collapsible white row, the existing options inside it
  return (
    <div className="mt-4 rounded-[20px] border border-frenz-line bg-frenz-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-[3.25rem] w-full items-center justify-between gap-3 rounded-[20px] px-3.5 text-left text-[15px] font-bold text-frenz-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
      >
        {label}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-frenz-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="space-y-4 border-t border-frenz-line px-3.5 pb-4 pt-3.5">
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
  // step 18: one row of the Settings list — title on the left, the value on the right, a native picker underneath
  return (
    <div className={cn("relative flex min-h-[3.5rem] items-center gap-3 px-3.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-frenz-violet", disabled && "opacity-55", className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-frenz-violet/10 text-frenz-violet">
        <Icon className="h-[17px] w-[17px]" aria-hidden />
      </span>
      <span id={`${id}-l`} className="min-w-0 flex-1 truncate text-[15px] font-semibold text-frenz-ink">
        {label}
      </span>
      <span className="max-w-[45%] truncate text-[14px] text-frenz-muted">{current}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
      <select
        aria-labelledby={`${id}-l`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
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

/** The design's "Settings" group: one white card, a hairline between rows (steps 18–19). */
export function AiSettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section aria-label="Settings" className={className}>
      <h2 className="m-0 mb-2 px-1 font-heading text-[17px] font-bold text-frenz-ink">Settings</h2>
      <div className="divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card">{children}</div>
    </section>
  );
}

/**
 * The creation screens' header (steps 18–19): "‹ Studio" back on the left, the tool's name centred, the
 * balance on the right; then the tool's line in large type.
 */
export function AiCreateHeader({ backHref, title, tagline }: { backHref: string; title: string; tagline: string }) {
  return (
    <header className="frenz-ui pt-1">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Link href={backHref} className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 justify-self-start text-[16px] font-bold text-frenz-blue no-underline">
          <ChevronLeft className="h-5 w-5" aria-hidden />
          Studio
        </Link>
        <h1 className="m-0 truncate text-center font-heading text-[17px] font-bold text-frenz-ink">{title}</h1>
        <span className="justify-self-end">
          <AiCreditsChip />
        </span>
      </div>
      <p className="m-0 mt-3 px-1 font-heading text-[26px] font-extrabold leading-[1.1] tracking-[-0.8px] text-frenz-ink">{tagline}</p>
    </header>
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
  inputRef,
  footer,
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
  /** the textarea — a prompt suggestion focuses it and grows it to show the whole text (2026-10-15) */
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Step 18: inside the box, under the text — "Explore prompts" and the dictation mic. The counter sits on the right. */
  footer?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block font-heading text-[17px] font-bold text-frenz-ink">
            {label}
          </label>
          {hint ? <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-frenz-muted">{hint}</p> : null}
        </div>
        {aside}
      </div>
      <div className="relative mt-2.5 rounded-[20px] border border-frenz-line bg-frenz-card shadow-frenz-card transition focus-within:ring-2 focus-within:ring-frenz-violet/50">
        <textarea
          ref={inputRef}
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.slice(0, max))}
          rows={rows}
          placeholder={placeholder}
          className="block w-full resize-y rounded-[20px] border-0 bg-transparent px-4 pb-2 pt-3.5 text-base leading-relaxed text-frenz-ink placeholder:text-frenz-muted focus-visible:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {footer}
          <span className="ml-auto text-[12px] tabular-nums text-frenz-muted" aria-live="off">
            {value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
          </span>
        </div>
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
  icon: _icon,
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
  // step 18: "Style · Or describe any style" — the real sample pictures, a ring and a check on the chosen one
  return (
    <section aria-labelledby={`${id}-l`}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={`${id}-l`} className="m-0 font-heading text-[17px] font-bold text-frenz-ink">
          {label}
        </h2>
        <span className="text-[13px] text-frenz-muted">Or describe any style</span>
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-l`} className="mt-2.5 grid grid-cols-4 gap-2">
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
              className="text-center transition active:scale-[0.97] focus-visible:outline-none motion-reduce:active:scale-100 [&:focus-visible>span]:ring-frenz-violet"
            >
              <span className={cn("relative block overflow-hidden rounded-2xl ring-2 ring-offset-2 ring-offset-frenz-page transition", on ? "ring-frenz-violet" : "ring-transparent")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a 264×152 webp already at its display size */}
                <img src={o.image} alt="" width={264} height={152} loading="lazy" decoding="async" className="block aspect-[3/4] w-full object-cover" />
                {on ? (
                  <span aria-hidden className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-frenz-violet text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : null}
              </span>
              <span className={cn("mt-1.5 block truncate text-[13px] leading-tight", on ? "font-bold text-frenz-ink" : "font-semibold text-frenz-muted")}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
