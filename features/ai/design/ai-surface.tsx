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

/* ─────────────────────────────── the stage ──────────────────────────────── */

/**
 * The hero visual: a frosted stage with a lit centre and orbs drifting round it.
 *
 * ── 🔴 WHY THIS EXISTS (owner, 2026-09-28: "Nothing changed in the Ai upgrade
 * pages") ───────────────────────────────────────────────────────────────────
 *
 * The first pass at this migration shipped a design SYSTEM and applied only the
 * one part of it that changes nothing anyone can see: the hero swapped a
 * hand-rolled eyebrow for a breadcrumb pill at the same type scale, and the
 * background moved from four inline gradients to one class that looks much like
 * them. Six of the eight primitives were used zero times. That was a refactor
 * wearing a redesign's commit message.
 *
 * This is the piece both references actually lead with and neither page had:
 * the centrepiece. `frenz ai welcome page.jpg` puts two glass video cards and a
 * lit logo bubble here; `ai input page.jpg` puts one glass frame with a play
 * button. The constant is a FROSTED STAGE WITH DEPTH — a lit centre, a soft rim,
 * and small spheres at different distances.
 *
 * ── Built from CSS, not from an image ───────────────────────────────────────
 *
 * No new dependency and nothing to download: gradients, blur and transforms
 * only. The motion reuses the environment's existing `.frenz-ai-orbit` /
 * `.frenz-ai-breathe` / `.frenz-ai-drift` classes, which are already driven by
 * `--ai-orbit` / `--ai-breath` / `--ai-intensity` and — importantly — already
 * stop dead on a hidden tab and under `prefers-reduced-motion` via `--ai-play`.
 * Inventing a second animation system here would have been the same mistake in
 * a different file.
 */
export function AiHeroStage({
  children,
  className,
  height = "default",
}: {
  /** What sits at the centre — a logo, a preview, a glyph. */
  children?: ReactNode;
  className?: string;
  height?: "default" | "tall";
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative isolate w-full overflow-hidden rounded-[1.9rem]",
        height === "tall" ? "h-64 sm:h-80" : "h-48 sm:h-60",
        "bg-gradient-to-br from-white/80 via-violet-50/70 to-sky-50/70",
        "ring-1 ring-inset ring-white/80",
        "shadow-[0_26px_70px_-40px_rgba(76,58,160,0.55)]",
        className,
      )}
    >
      {/* the lit centre — the thing that makes it read as depth rather than a box */}
      <span
        className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,255,255,0.95) 0%, rgba(196,181,253,0.55) 45%, rgba(147,197,253,0.18) 70%, transparent 100%)",
        }}
      />

      {/* two rings, counter-weighted, on the compositor */}
      <span className="frenz-ai-orbit pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 sm:h-52 sm:w-52" />
      <span className="frenz-ai-drift pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200/60 sm:h-72 sm:w-72" />

      {/* the spheres from the reference, at three distances */}
      <Orb className="left-[12%] top-[22%] h-6 w-6" />
      <Orb className="right-[14%] top-[30%] h-4 w-4" />
      <Orb className="left-[22%] bottom-[18%] h-3.5 w-3.5" />
      <Orb className="right-[20%] bottom-[22%] h-7 w-7" />

      {children ? (
        <div className="frenz-ai-breathe absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/75 shadow-[0_18px_44px_-20px_rgba(76,58,160,0.6),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-inset ring-white/90 backdrop-blur-xl sm:h-24 sm:w-24">
            {children}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** One of the reference's little spheres. Decorative; never announced. */
function Orb({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "frenz-ai-breathe pointer-events-none absolute rounded-full",
        "bg-gradient-to-br from-violet-400 to-sky-500",
        "shadow-[0_6px_16px_-6px_rgba(99,102,241,0.8),inset_0_1px_1px_rgba(255,255,255,0.7)]",
        className,
      )}
    />
  );
}
