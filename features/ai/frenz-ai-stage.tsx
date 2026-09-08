"use client";

import type { ReactNode } from "react";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import type { AiCleanStage } from "@/lib/ai/job-stages";
import { presenceFor } from "@/lib/ai/presence";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI STAGE — one composition, used by every AI surface
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Environment, core, title, and whatever the surface puts under them.
 *
 * ── Why this exists rather than each page composing it ───────────────────────
 *
 * The hub and AI Clean both want "the core, breathing, with a line of text and
 * the work below". Written twice they drift: the core ends up a different size
 * on one, the spacing goes out by a step, and the two stop feeling like one
 * environment — which is the entire thing the upgrade is for.
 *
 * ── Not a rectangular SaaS card ──────────────────────────────────────────────
 *
 * The brief is specific that the workspace must not read as a dashboard panel.
 * So the framing is a deliberately soft one: a wide, low-contrast surface with
 * generous vertical breathing room and light that appears to come from behind
 * it, rather than a bordered box with a header bar. The border is a hairline
 * that all but disappears in dark mode, where the ambient light does the work
 * of defining the edge instead.
 */
export function FrenzAIStage({
  stage = "idle",
  armed = false,
  eyebrow,
  title,
  subtitle,
  /** Sits under the heading — the actual work. */
  children,
  /** Optional right-hand furniture in the header row. */
  action,
  className,
  coreSize = "xl",
  tight = false,
}: {
  stage?: AiCleanStage;
  armed?: boolean;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  coreSize?: "lg" | "xl";
  /**
   * Pull the mark, eyebrow and headline together.
   *
   * 🔴 A direct instruction, not a taste call. The owner's reference image
   * (`public/frenz ai page.jpg`) is annotated "tighter spacing between logo and
   * headline — feels more energetic and focused", with an arrow at exactly this
   * gap. The generous default reads as a marketing hero; tight reads as a tool
   * somebody is about to use, which is what the hub is.
   */
  tight?: boolean;
}) {
  return (
    <FrenzAIEnvironment
      stage={stage}
      armed={armed}
      className={cn(
        "overflow-hidden rounded-[1.75rem] border border-border/50 bg-card/70 backdrop-blur-xl",
        // Depth from light rather than from a heavy border: an inset highlight
        // along the top edge, a soft drop below. In dark mode the ambient wash
        // behind is what actually defines the shape.
        "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),0_24px_60px_-32px_hsl(229_55%_3%/0.45)]",
        className,
      )}
    >
      <div className="px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col items-center text-center">
          <FrenzAICore presence={presenceFor({ stage, armed })} size={coreSize} />

          {eyebrow ? (
            <span className={cn("text-[11px] font-bold uppercase tracking-[0.22em] text-primary", tight ? "mt-2" : "mt-5")}>
              {eyebrow}
            </span>
          ) : null}

          <h1 className={cn("text-[1.7rem] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[2.1rem]", tight ? "mt-1" : "mt-2")}>
            {title}
          </h1>

          {subtitle ? (
            <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}

          {action ? <div className="mt-5">{action}</div> : null}
        </div>

        {children ? <div className={tight ? "mt-6" : "mt-8"}>{children}</div> : null}
      </div>
    </FrenzAIEnvironment>
  );
}
