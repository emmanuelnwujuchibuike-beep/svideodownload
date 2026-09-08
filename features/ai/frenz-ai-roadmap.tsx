import { ArrowRight, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The two blocks under the AI Clean card in the owner's reference
 * (`public/frenz ai page.jpg`): a small "N AI tools available" pill, and the
 * roadmap panel its annotation calls "a more intentional coming soon section —
 * turned empty space into a roadmap moment".
 *
 * ── 🔴 THE WORD "SOON" IS A DELIBERATE, SCOPED EXCEPTION ─────────────────────
 *
 * There is a standing instruction against it (owner, 2026-09-08: "make sure
 * there is no soon anywhere because google crawler flags soon and low value
 * content"), and a newer instruction to build this image exactly. Both are
 * real, so the resolution is not to pick one — it is to notice they are about
 * different readers.
 *
 * That rule protects the AdSense review, which is about INDEXED pages. This
 * panel therefore takes its copy as props, and the caller decides:
 *
 *   - `/studio/ai` is `robots: noindex` behind an auth redirect. No crawler can
 *     reach it, so it renders the owner's exact words.
 *   - a public, indexable surface passes roadmap copy with no "soon" in it.
 *
 * ⚠️ If this component is ever mounted on an indexable route, pass the copy
 * explicitly. The defaults below are the drawn ones, and they belong behind
 * `noindex`.
 */
export function FrenzAIToolCount({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn("flex justify-center", className)}>
      <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] px-4 py-2 text-[13px] font-semibold text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
        {count} AI {count === 1 ? "tool" : "tools"} available
      </span>
    </div>
  );
}

export function FrenzAIRoadmap({
  title = "More tools are coming soon",
  body = "More intelligence is coming. New creative tools are being added to Frenz AI.",
  pill = "Coming Soon",
  className,
}: {
  title?: string;
  body?: string;
  /** Pass null to render the panel with no pill at all. */
  pill?: string | null;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[1.5rem] border border-primary/15",
        // The soft lavender ground from the reference, in both themes.
        "bg-gradient-to-br from-violet-500/[0.09] via-primary/[0.06] to-transparent",
        "px-4 py-4 sm:px-5",
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-500 ring-1 ring-inset ring-violet-500/25 dark:text-violet-300">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[0.95rem] font-bold leading-snug tracking-[-0.01em]">{title}</h3>
            {pill ? (
              <span className="shrink-0 rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-semibold text-violet-600 ring-1 ring-inset ring-violet-500/25 dark:text-violet-300">
                {pill}
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>

      {/*
        The arrow from the reference, bottom-right. Decorative and NOT a link:
        there is nowhere for it to go yet, and a chevron that looks pressable
        and does nothing is the affordance this codebase has deleted three
        separate times. It marks direction, not a destination.
      */}
      <span aria-hidden className="pointer-events-none absolute bottom-3.5 right-4 text-muted-foreground/50">
        <ArrowRight className="h-4 w-4" />
      </span>
    </section>
  );
}
