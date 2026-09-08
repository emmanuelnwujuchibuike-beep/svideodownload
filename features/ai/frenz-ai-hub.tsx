import { FrenzAICleanShowcase } from "@/features/ai/frenz-ai-clean-showcase";
import { FrenzAIRoadmap, FrenzAIToolCount } from "@/features/ai/frenz-ai-roadmap";
import { FrenzAIStage } from "@/features/ai/frenz-ai-stage";
import { openableFrenzAiTools } from "@/lib/ai/studio-tools";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI HUB — one composition, two mount points
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built to `public/frenz ai page.jpg` (owner, 2026-09-08: "build everything
 * exactly in details as it in the image, dont skip or simplify any thing"),
 * top to bottom:
 *
 *   Core → FRENZ AI → "Create more. Edit smarter." → subtitle
 *   → the AI Clean showcase card
 *   → "N AI tools available"
 *   → the roadmap panel
 *
 * ── 🔴 THE SPACING IS AN INSTRUCTION, NOT A DEFAULT ─────────────────────────
 *
 * The first annotation on that image reads "tighter spacing between logo and
 * headline — feels more energetic and focused". So `tight` exists and the hub
 * passes it: the gap between the Core and the eyebrow drops from `mt-5` to
 * `mt-2`, and the eyebrow-to-headline from `mt-2` to `mt-1`. Small numbers, and
 * they are the difference the owner actually asked for — a stage that breathes
 * generously reads as a marketing page, and a tighter one reads as a tool.
 *
 * ── Why it is extracted from the page ────────────────────────────────────────
 *
 * Because there are two audiences for it. `/studio/ai` is a signed-in creator's
 * dashboard, `noindex`, inside the Studio nav. A public surface has to be
 * crawlable and speaks to someone with no account. Written twice they drift —
 * the card ends up a different size on one, the spacing goes out by a step, and
 * the two stop feeling like one product, which is the whole thing the visual
 * upgrade was for.
 *
 * A server component. No hooks, no state — see the note in
 * frenz-ai-tool-card.tsx about what marking one of these `"use client"` did.
 */
export function FrenzAIHub({
  /**
   * Where the AI Clean card points. Different per mount so a signed-out
   * visitor is never sent into the Studio shell, which would redirect them.
   */
  cleanHref = "/studio/ai/clean",
  /** The roadmap panel's words. See FrenzAIRoadmap for why these are props. */
  roadmap,
  className,
}: {
  cleanHref?: string;
  roadmap?: { title?: string; body?: string; pill?: string | null };
  className?: string;
}) {
  // The registry's own filter, so a tool appears the moment it gets an href and
  // not a moment before.
  const tools = openableFrenzAiTools();

  return (
    <div className={cn(className)}>
      <FrenzAIStage
        tight
        eyebrow="Frenz AI"
        title="Create more. Edit smarter."
        subtitle="Powerful AI tools designed to help you transform your content faster."
      >
        <FrenzAICleanShowcase href={cleanHref} />
      </FrenzAIStage>

      <FrenzAIToolCount count={tools.length} className="mt-4" />

      <FrenzAIRoadmap className="mt-4" {...roadmap} />
    </div>
  );
}
