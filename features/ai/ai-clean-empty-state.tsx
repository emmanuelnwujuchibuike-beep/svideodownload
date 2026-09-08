"use client";

import { ArrowRight, Link2, Sparkles, Zap } from "lucide-react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FrenzAIInputScene } from "@/features/ai/core/frenz-ai-input-scene";
import { AICleanUpload } from "@/features/ai/ai-clean-upload";
import { FrenzAIAllowanceBar, FrenzAICrumb, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import type { AiCleanEntitlement } from "@/lib/ai/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE INPUT PAGE — where a video is chosen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from `public/ai input page.jpg` (owner, 2026-09-08: "use the exact
 * reference in the input page I saved in public as the new input page, it
 * should be exactly not simplifying").
 *
 * Top to bottom, as drawn: the breadcrumb, the headline with "videos" in brand
 * gradient, the subhead, the scene beside them, the drop zone, "Paste video
 * link", the AI Powered card, the allowance bar and the trust row.
 *
 * ── 🔴 THIS REPLACED THE OLD HERO, WHICH IS THE POINT ───────────────────────
 *
 * The owner's instruction was "remove the frenz Ai hero section", and the thing
 * being removed was `FrenzAIHeader` plus the dots allowance strip that sat
 * above this. The headline did not go away — it moved INTO this page and got a
 * scene beside it, which is what the reference shows. So the workspace no
 * longer renders a header above the idle state; this component is the whole
 * screen.
 *
 * ── The performance rule, which was part of the same instruction ────────────
 *
 * "only do not break the performance and over heating rule". No photographs,
 * no new library, `backdrop-blur` confined to small boxes rather than stretched
 * across the page, and the only motion is one slow arc and a twinkle — both
 * stopping under `prefers-reduced-motion` and on a hidden tab.
 *
 * ── What did NOT change ─────────────────────────────────────────────────────
 *
 * `AICleanUpload` is reused untouched. It already holds the drag-and-drop
 * handling, the file-type gate and the accessible label wiring — all of which
 * are easy to get subtly wrong and none of which the redesign asked to change.
 * This page is a new arrangement around the same working control.
 */
export function AICleanEmptyState({
  onFile,
  onPasteLink,
  entitlement,
}: {
  onFile: (file: File) => void;
  onPasteLink: () => void;
  /** Null until the server answers; the bar renders nothing until then. */
  entitlement?: AiCleanEntitlement | null;
}) {
  return (
    <div className="px-1 pb-2">
      <FrenzAICrumb tool="AI Clean" />

      {/* ── headline, with the scene beside it ───────────────────────────── */}
      <div className="mt-3.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.95rem] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[2.3rem]">
            Clean your <span className="text-gradient">videos</span>
            <br />
            with AI.
          </h1>
          <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-muted-foreground">
            Remove unwanted captions, subtitles and text overlays while keeping your video looking
            natural.
          </p>
        </div>

        {/*
          🔴 VISIBLE ON A PHONE. It was `hidden sm:block` for one revision, and
          the screenshot harness reported the arc's gradient painting on a
          zero-area box — the giveaway that the whole scene was `display: none`
          at the width the reference was DRAWN at.

          That is the same mistake as hiding the Subtitles/Captions chips on the
          AI Clean card: a phone reference means the phone layout is the design,
          not the fallback. It is sized in a fixed ratio and the copy column is
          `min-w-0 flex-1`, so the headline reflows around it rather than the two
          fighting for the row.
        */}
        <FrenzAIInputScene className="h-24 w-28 shrink-0 sm:h-36 sm:w-44" />
      </div>

      {/* ── the drop zone ────────────────────────────────────────────────── */}
      <div className="mt-5">
        <AICleanUpload onFile={onFile} onPasteLink={onPasteLink} showPasteLink={false} />
      </div>

      {/* ── paste a link ─────────────────────────────────────────────────── */}
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={onPasteLink}
          className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-5 py-3 text-sm font-semibold backdrop-blur transition hover:border-foreground/20 active:scale-[0.99]"
        >
          <Link2 className="h-4 w-4 text-primary" aria-hidden />
          Paste video link
          <ArrowRight
            className="h-4 w-4 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>
      </div>

      {/* ── the AI Powered card ──────────────────────────────────────────── */}
      <section className="mt-4 flex items-center gap-3 rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-violet-500/[0.05] to-transparent px-3.5 py-3.5 backdrop-blur">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-card/90 ring-1 ring-inset ring-border/70">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold">AI Powered</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Fast, secure and natural results with advanced AI technology.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card/90 px-3 py-1.5 text-[11px] font-bold text-primary ring-1 ring-inset ring-border/70">
          <Zap className="h-3.5 w-3.5" aria-hidden />
          Pro
        </span>
      </section>

      {/*
        The allowance moved DOWN here from above the stage. On the old layout it
        was the second thing on the page, which made a limit the first fact
        somebody read about a tool they had not tried yet. The reference puts it
        after the action, and that is the better order.
      */}
      <FrenzAIAllowanceBar entitlement={entitlement ?? null} className="mt-4" />

      <FrenzAITrustRow className="mt-5" />

      {/* The mark, quietly, at the very bottom — as the reference closes. */}
      <div aria-hidden className="mt-5 flex justify-center opacity-30">
        <FrenzLogo size={18} alt="" />
      </div>
    </div>
  );
}
