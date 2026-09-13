import { ChevronRight, History, Wand2 } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MORE AI TOOLS — the grid from the reference, cut to what exists
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, with a full-page screenshot: "Make the Ai welcome page to
 * be exactly like this in details no simplifying only make the performance
 * faster and smoother on all devices, on all devices the Down section should be
 * grid… replace 1 card that isn't a real feature with the Ai history button.
 * There should be no cluster."
 *
 * ── 🔴 TWO COLUMNS AT EVERY WIDTH, INCLUDING THE SMALLEST PHONE ─────────────
 *
 * `grid-cols-2` with no breakpoint. The instruction is explicit ("on all
 * devices the Down section should be grid"), and the reference is drawn on a
 * phone showing two across — so a responsive single column would be the
 * simplification the same sentence rules out.
 *
 * That constrains the card: at 2-up on a 360px screen each is ~160px wide, so
 * the title is one line, the blurb is clamped to three, and nothing else
 * competes. Getting that budget wrong is precisely the "cluster" being warned
 * against.
 *
 * ── 🔴 THE PREVIEWS ARE PAINTED, NOT FETCHED ────────────────────────────────
 *
 * The reference shows a small photo on each card. Photographs would be
 * network requests, decodes and layout shifts on a page whose
 * own instruction is "make the performance faster and smoother on all devices"
 * — and this page already refuses per-tile images in the history grid for the
 * same reason.
 *
 * So each preview is a CSS gradient with the tool's own glyph over it: the same
 * shape, the same position, the same weight in the composition, and zero bytes.
 * It reads as a thumbnail without being one.
 *
 * ── 🔴 A SERVER COMPONENT ───────────────────────────────────────────────────
 *
 * No `"use client"`, no hooks, no state. Two cards of static markup have no
 * business in the hydration budget — and this file's neighbour
 * (frenz-ai-tool-card.tsx) carries a note about what marking one of these a
 * client component cost last time.
 */

interface AiTool {
  id: string;
  name: string;
  blurb: string;
  icon: typeof Wand2;
  /**
   * 🔴 Never null. Until 2026-09-13 this was `string | null`, and a null
   * rendered a flat card that said "Soon". Owner: "remove the soon cards from
   * the ai page." Making the field required means a card with nowhere to go
   * cannot be added back by accident — it fails the build instead.
   */
  href: string;
  /** The icon tile's gradient, and the preview's tint. */
  accent: string;
  preview: string;
}

/**
 * ── 🔴 TWO CARDS, BOTH REAL ─────────────────────────────────────────────────
 *
 * The reference drew four: AI Clean, AI Enhance, AI Video Edit and AI Text
 * Remover. Two instructions since have cut it to what actually exists:
 *
 *   · 2026-09-09: "replace 1 card that isn't a real feature with the Ai
 *     history button" — AI Text Remover went, being both unbuilt and a
 *     description of what AI Clean already does;
 *   · 2026-09-13: "remove the soon cards from the ai page" — AI Enhance and AI
 *     Video Edit went, and with them the whole "not built yet" branch of the
 *     card. A grid of things that cannot be tapped is not a feature list.
 *
 * What remains is every door this product has, and each one opens.
 */
function tools(cleanHref: string, historyHref: string): AiTool[] {
  return [
    {
      id: "clean",
      name: "AI Clean",
      blurb: "Remove unwanted text, subtitles and captions.",
      icon: Wand2,
      href: cleanHref,
      accent: "from-blue-600 to-indigo-600",
      preview: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.10))",
    },
    {
      id: "history",
      name: "Your AI videos",
      blurb: "Everything you have cleaned, kept for three days.",
      icon: History,
      href: historyHref,
      accent: "from-amber-500 to-orange-600",
      preview: "linear-gradient(135deg, rgba(245,158,11,0.16), rgba(249,115,22,0.10))",
    },
  ];
}

export function FrenzAIToolGrid({
  cleanHref,
  historyHref,
  className,
}: {
  cleanHref: string;
  historyHref: string;
  className?: string;
}) {
  const items = tools(cleanHref, historyHref);

  return (
    /*
      ── 🔴 NO HEADER (owner, 2026-09-13) ──────────────────────────────────

      The reference drew a "More AI Tools" title with a blurb above the grid.
      Owner, with a screenshot of exactly that block: "Remove this section
      from the Ai welcome page." The cards stay — they are the only doors to
      AI Clean and to history — so the section keeps an accessible name via
      `aria-label` now that there is no heading for `aria-labelledby` to point
      at.
    */
    <section className={cn(className)} aria-label="AI tools">
      {/*
        🔴 `grid-cols-2` with NO breakpoint — the instruction is "on all devices
        the Down section should be grid". Two cards, two columns, at every width.
      */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </section>
  );
}

function ToolCard({ tool }: { tool: AiTool }) {
  const { icon: Icon, href, name, blurb, accent, preview } = tool;

  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "group flex min-h-[9.5rem] flex-col rounded-[1.25rem] p-3.5",
        "bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10",
        "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99] shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)]",
      )}
    >
      {/* Icon tile and preview, side by side — the reference's top row. */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm",
            accent,
          )}
        >
          <Icon className="h-[21px] w-[21px]" aria-hidden />
        </span>

        {/*
          The "thumbnail". Painted, not fetched — see the note at the top. It is
          `aria-hidden` because it carries no information a screen reader could
          use; the title and blurb say what the card is.
        */}
        <span
          aria-hidden
          className="hidden h-11 w-[52px] shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/[0.04] dark:ring-white/10 min-[340px]:flex"
          style={{ background: preview }}
        >
          <Icon className="h-4 w-4 text-foreground/35" />
        </span>
      </div>

      {/* `h2`: the page has an h1 and, since 2026-09-13, no section heading between. */}
      <h2 className="mt-3 text-[14.5px] font-bold leading-tight">{name}</h2>
      {/*
        🔴 Clamped to three lines. At two columns on a 360px phone a card is
        ~160px wide, and an unclamped blurb pushes one card taller than its
        row-mate — which is what "cluster" looks like in a grid.
      */}
      <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-muted-foreground">{blurb}</p>

      <div className="mt-auto flex items-center justify-end pt-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 ring-1 ring-inset ring-black/[0.06] transition group-hover:bg-background dark:ring-white/10">
          <ChevronRight className="h-4 w-4 text-foreground/70" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
