"use client";

import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";

import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import type { FrenzAiStudioTool } from "@/lib/ai/studio-tools";
import { cn } from "@/lib/utils";

/**
 * One tool on the Frenz AI hub.
 *
 * ── An unbuilt tool is not a button ───────────────────────────────────────────
 * A `soon` tool renders as a plain, unfocusable panel: no link, no hover lift,
 * no cursor change, and the icon tile drops to the muted surface instead of the
 * brand gradient. Every one of those is deliberate — a card that LOOKS pressable
 * and does nothing is the affordance this codebase has had to delete three
 * separate times. The "Coming soon" pill is the label, and the flat treatment is
 * what makes it believable before anyone reads it.
 *
 * ── The edge is the microinteraction (2026-09-07) ────────────────────────────
 *
 * An openable card carries a gradient edge that lights on hover and focus, and
 * the whole card lifts a hairline. Both are `transform` and `opacity` only, both
 * are behind `motion-safe`, and neither runs when nothing is happening — this is
 * response to a person, not ambient decoration, so it costs nothing on an idle
 * page.
 *
 * The icon tile carries the Frenz AI Core rather than a generic glyph, so the
 * mark that means "this is AI" is the same one on the hub, in the workspace and
 * in every processing state.
 *
 * A client component now, because the Core is one. It still renders a real
 * `<Link>`, so a tap on a cold page is an ordinary navigation rather than a
 * dead one.
 */
export function FrenzAIToolCard({ tool }: { tool: FrenzAiStudioTool }) {
  const { icon: Icon, href, status, name, blurb, pro } = tool;
  const open = href !== null;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition",
            open ? "bg-brand-tile shadow-sm" : "bg-secondary text-muted-foreground",
          )}
        >
          {open ? (
            // The AI mark, not a tool glyph: what this card opens is Frenz AI.
            <FrenzAICore presence="calm" size="md" />
          ) : (
            <Icon className="h-[22px] w-[22px]" aria-hidden />
          )}
        </span>

        <div className="flex items-center gap-1.5">
          {pro ? <AICleanProBadge /> : null}
          {status === "soon" ? (
            <span className="inline-flex select-none items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Lock className="h-2.5 w-2.5" aria-hidden />
              Coming soon
            </span>
          ) : null}
        </div>
      </div>

      <h2 className={cn("mt-4 text-base font-bold tracking-[-0.01em]", !open && "text-muted-foreground")}>{name}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{blurb}</p>

      {/* `self-start` matters: the card is a column flex container, so without it
          the pill stretches to the full width on every breakpoint and `w-auto`
          alone does nothing. Full-width on a phone is the right target size;
          hugging its label on a desktop is the right weight. */}
      {open ? (
        <span className="btn-lux btn-lux-primary mt-5 w-full sm:w-auto sm:self-start" aria-hidden>
          Open {name}
          <ArrowRight className="h-4 w-4" />
        </span>
      ) : null}
    </>
  );

  const shell =
    "group relative flex h-full flex-col rounded-3xl border p-5 transition sm:p-6";

  if (!open) {
    return (
      <div className={cn(shell, "border-dashed border-border/70 bg-card/40")}>{body}</div>
    );
  }

  return (
    <Link
      href={href}
      prefetch
      // The card is the control, so it carries the accessible name: the visible
      // "Open …" pill inside is aria-hidden, which is what stops a screen reader
      // announcing the tool's name twice on one link.
      aria-label={`Open ${name}`}
      className={cn(
        shell,
        "group border-transparent bg-card shadow-card outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.995]",
      )}
    >
      {/*
        The gradient edge. A masked border rather than a glow: the gradient
        fills the element, and `mask-composite: exclude` punches out everything
        but the 1px rim, so the colour is ON the edge instead of bleeding
        outwards like a cheap shadow. Opacity-only transition, so lighting it
        costs nothing.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-45 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        style={{
          padding: "1px",
          background:
            "linear-gradient(135deg, hsl(var(--brand-blue) / 0.7), hsl(var(--brand-purple) / 0.55) 55%, transparent 85%)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {body}
    </Link>
  );
}
