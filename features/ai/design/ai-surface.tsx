import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI SURFACE — ONE DEFINITION OF THE LANGUAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "the instruction and design style should also apply for
 * the ai welcome page and all pages, including the character replace pages and
 * text to audio and voice cloning page and not only the pages in the reference
 * image i showed you."
 *
 * ── What the references actually specify ────────────────────────────────────
 *
 * `public/frenz ai welcome page.jpg` and `public/ai input page.jpg` are the
 * same system twice, which is the useful thing about having two: what they
 * share IS the system, and what differs is content.
 *
 *   • a light iridescent wash — lavender into periwinkle into a blush of pink,
 *     never flat white, never dark
 *   • a breadcrumb pill: logo chip · "Frenz AI / <tool>" · the tier seal
 *   • a display headline at ~2rem, tracking pulled in hard, with ONE word in
 *     the brand gradient
 *   • frosted glass panels with a hairline inner edge and a wide, soft,
 *     coloured shadow — not a grey box shadow
 *   • one gradient pill as the primary action, one bordered glass pill beside
 *     it, never two gradients competing
 *   • an allowance bar and a three-item trust row closing the page
 *
 * ── 🔴 WHY THIS IS A MODULE AND NOT A STYLE GUIDE ───────────────────────────
 *
 * Because the drift already happened. Every AI screen currently opens with its
 * own hand-rolled header and its own inline `radial-gradient` background — the
 * welcome page carries four of them as literal strings. Written once, they
 * stay one product; written per page, one gets a different radius and another a
 * different gap, and two screens a member moves between in a single tap stop
 * looking like the same thing.
 *
 * `frenz-ai-chrome.tsx` already holds the crumb, the allowance bar and the
 * trust row for exactly this reason. This is the rest of it.
 *
 * ── Server components. Every one. ───────────────────────────────────────────
 *
 * No hooks, no state, no handlers. These render inside workspaces that are
 * already client components; marking a shared primitive `"use client"` would
 * pull every page that composes it across the boundary, and this project has
 * paid for that mistake before (see the note in frenz-ai-tool-card.tsx).
 *
 * ── Light mode ──────────────────────────────────────────────────────────────
 *
 * The brief says light only, and these carry no `dark:` variants. That is a
 * statement about the AI surface, not a removal of the app's theme: the 69
 * `dark:` variants elsewhere under features/ai are left alone until each page
 * actually adopts these primitives, so nothing changes appearance before it is
 * deliberately moved over.
 */

/* ───────────────────────────── the page shell ───────────────────────────── */

/**
 * The iridescent ground every Frenz AI screen sits on.
 *
 * The wash itself lives in `globals.css` as `.ai-wash`, so it is one gradient
 * rather than one per page — and so a page can opt into it without shipping
 * four gradient strings in its JSX.
 */
export function AiPageShell({
  children,
  className,
  /** Narrower than the default for a focused single-column tool. */
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "narrow" | "wide";
}) {
  return (
    <div className={cn("ai-wash relative min-h-full", className)}>
      <div
        className={cn(
          "relative mx-auto w-full px-4 pb-16 pt-4 sm:px-6",
          width === "narrow" && "max-w-xl",
          width === "default" && "max-w-2xl",
          width === "wide" && "max-w-5xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────── the hero ──────────────────────────────── */

/**
 * The display headline, on its own.
 *
 * Split out of `AiHero` because Character Replace renders its crumb ONCE at the
 * top and then swaps the headline per step — seven of them — so it needs the
 * type without the breadcrumb. It kept a private copy with byte-identical
 * classes; this is that copy, promoted, so the scale can only be changed in one
 * place.
 *
 * ONE gradient word. The references put exactly one in the headline and the
 * restraint is the effect; two read as a rainbow rather than as emphasis.
 */
export function AiDisplayTitle({
  title,
  highlight,
  tail,
  subtitle,
  className,
}: {
  title: string;
  highlight?: string;
  tail?: string;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <>
      <h1 className={cn("text-[1.95rem] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[2.3rem]", className)}>
        {title}
        {highlight ? (
          <>
            {" "}
            <span className="text-gradient">{highlight}</span>
          </>
        ) : null}
        {tail ? (
          <>
            <br />
            {tail}
          </>
        ) : null}
      </h1>
      {subtitle ? (
        <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
    </>
  );
}

/**
 * The opening of every AI screen: crumb, display headline, subtitle, actions.
 *
 * 🔴 `tool` IS REQUIRED. The component this replaces defaulted its breadcrumb
 * to "AI Clean" — a product that was RETIRED and must never be re-added — so
 * every page that adopted it would have announced a tool that does not exist.
 * It was rendered nowhere, which is the only reason that never shipped. A
 * required prop makes the same mistake impossible rather than unlikely.
 *
 * `highlight` is the one word in brand gradient. One. The references put
 * exactly one coloured word in the headline and the restraint is the effect;
 * two would read as a rainbow rather than as emphasis.
 */
export function AiHero({
  tool,
  title,
  highlight,
  tail,
  subtitle,
  actions,
  aside,
  className,
}: {
  /** The breadcrumb's trailing crumb, e.g. "Text to Audio". */
  tool: string;
  /** The words before the gradient word. */
  title: string;
  /** The single word rendered in brand gradient. */
  highlight?: string;
  /** The words after it, usually on their own line. */
  tail?: string;
  subtitle?: string | null;
  actions?: ReactNode;
  /** The hero visual, on the right at width. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("px-1", className)}>
      <FrenzAICrumb tool={tool} />

      <div className={cn(aside && "sm:flex sm:items-center sm:gap-6")}>
        <div className="min-w-0 flex-1">
          <AiDisplayTitle title={title} highlight={highlight} tail={tail} subtitle={subtitle} className="mt-3.5" />

          {actions ? <div className="mt-4 flex flex-wrap items-center gap-2.5">{actions}</div> : null}
        </div>

        {aside ? <div className="mt-5 shrink-0 sm:mt-0">{aside}</div> : null}
      </div>
    </header>
  );
}

/* ─────────────────────────────── the panels ─────────────────────────────── */

/**
 * The frosted panel the references build every screen out of.
 *
 * The shadow is COLOURED and wide, not a grey drop shadow — that is most of
 * what reads as "glass" against the wash. `tone="dashed"` is the drop-target
 * variant from `ai input page.jpg`.
 */
export function AiGlassCard({
  children,
  className,
  tone = "solid",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  tone?: "solid" | "dashed" | "quiet";
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] bg-white/70 backdrop-blur-xl",
        "shadow-[0_18px_50px_-28px_rgba(76,58,160,0.45)]",
        tone === "solid" && "ring-1 ring-inset ring-white/70",
        tone === "quiet" && "ring-1 ring-inset ring-white/50 bg-white/55",
        tone === "dashed" && "border-2 border-dashed border-violet-300/60 bg-white/55",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Icon tile · title · body · optional trailing chip — the "AI Powered" card.
 *
 * Used for anything explanatory that is not itself an action, which is what
 * keeps the one gradient pill on a screen unambiguous.
 */
export function AiInfoCard({
  icon: Icon,
  title,
  children,
  trailing,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <AiGlassCard className={cn("flex items-center gap-3.5 p-4", className)}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-sky-100 ring-1 ring-inset ring-white/80">
        <Icon className="h-5 w-5 text-violet-600" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{children}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </AiGlassCard>
  );
}

/* ─────────────────────────────── the actions ────────────────────────────── */

/**
 * The one gradient pill on the screen.
 *
 * ⚠️ 56px TALL, AND THAT IS LOAD-BEARING. A global
 * `a[href] { min-height: var(--tap) }` rule once clamped every link's utility
 * `min-h-*` because (0,1,1) beats (0,1,0), and a CTA that measured 56px in the
 * markup rendered at 26px on the device. The height is set on BOTH `h-14` and
 * `min-h-[3.5rem]` so a specificity accident cannot silently shrink it again.
 *
 * `.ai-cta` carries the animated gradient, the sheen and the inner hairline —
 * see globals.css, where it is already paused on a hidden tab and under
 * reduced motion.
 */
export function AiPrimaryAction({
  href,
  children,
  icon: Icon = ArrowRight,
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  icon?: LucideIcon | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      className={cn(
        "ai-cta inline-flex h-14 min-h-[3.5rem] items-center justify-center gap-2 px-6 text-[15px] font-bold",
        "active:scale-[0.985] motion-reduce:active:scale-100",
        className,
      )}
      {...rest}
    >
      {children}
      {Icon ? <Icon className="h-[18px] w-[18px]" aria-hidden /> : null}
    </Link>
  );
}

/** The bordered glass pill that sits beside the primary one. Never a gradient. */
export function AiSecondaryAction({
  href,
  children,
  icon: Icon,
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-14 min-h-[3.5rem] items-center justify-center gap-2 rounded-full bg-white/75 px-5 text-[15px] font-semibold",
        "ring-1 ring-inset ring-white/80 shadow-[0_10px_30px_-20px_rgba(76,58,160,0.5)] backdrop-blur-xl",
        "active:scale-[0.985] motion-reduce:active:scale-100",
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> : null}
      {children}
    </Link>
  );
}

/* ─────────────────────────────── the rhythm ─────────────────────────────── */

/** A section title, at the one size every AI page uses for one. */
export function AiSectionHeading({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 mt-8 flex items-baseline justify-between gap-3 px-1", className)}>
      <h2 className="text-[1.05rem] font-bold tracking-[-0.02em]">{children}</h2>
      {hint ? <span className="shrink-0 text-[12.5px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/*
  ── 🔴 `AiHeroStage` WAS BUILT HERE AND DELETED THE SAME DAY ────────────────

  It was a large frosted panel with a lit core, orbit rings and floating
  spheres — added because the welcome page had no "centrepiece". The owner's
  own brief forbids it in as many words (§49): premium does NOT mean excessive
  glass, giant empty spaces, animated backgrounds or unnecessary 3D elements;
  it means precision, hierarchy, restraint and consistency.

  It read exactly as the brief predicted — a big empty box with balls in it —
  and it solved nothing, because the pages' problem was never a missing
  ornament. It was structure: undifferentiated white bordered cards, no
  category grouping, and forms where a creative workspace belongs.

  Do not re-add a decorative hero panel. Fix the hierarchy instead.
*/
