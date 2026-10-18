import { ArrowRight, Compass, Wand2 } from "lucide-react";
import Link from "next/link";

import { AiPromoLoader } from "@/features/downloads/ai-promo-loader";
import { promoStages, type AiPromo } from "@/lib/ai/promo/config";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI BANNER — the landing/download pair's featured action
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-18: "premium professional, high class structure of the landing
 * and Download page so the Frenz AI button gets very noticeable."
 *
 * It was one half of a [ Frenz AI | Wallpapers ] pair of white tiles (owner,
 * 2026-09-09: "too colourful … more of white"). It is now the page's one featured
 * door: a full-width banner straight under the paste card, and the only dark,
 * saturated object on a light page — which is what makes it the thing the eye
 * lands on, without making it any heavier.
 *
 * ── Still free after first paint ────────────────────────────────────────────
 *
 * A server component: no image, no blur, no JavaScript, no animation at rest
 * (owner, 2026-10-09: no continuously animated gradients). The gradient ring,
 * the glows and the CTA's glow are painted once. The promotion's media (Brief C)
 * still plays over the card after hydration, exactly as before.
 *
 * The ring is a 1.5px padded wrapper, not a border, so the inner card can keep
 * its own radius and the promotion's `rounded-[inherit]` overlay clips to it.
 */
export function FrenzAICta({
  className,
  promo = null,
}: {
  className?: string;
  /**
   * The landing promotion (Brief C, lib/ai/promo/config.ts). When it has media,
   * a tiny loader plays it over this banner after the page has loaded. Absent or
   * empty, the banner is exactly what it looks like at rest.
   */
  promo?: AiPromo | null;
}) {
  const playsMedia = !!promo && promoStages(promo).length > 1;
  return (
    <Link
      href="/ai"
      data-track="ai_clicked"
      /*
        Prefetched when the banner scrolls into view (owner, 2026-09-09: "the Frenz
        AI button doesn't respond on one tap"): /ai is ISR (revalidate 300), so the
        payload comes off the CDN and the tap is not the first fetch. Deliberately
        NOT `prefetch={true}`, which would fetch on mount for everybody.
      */
      className={cn(
        "group relative block rounded-[1.75rem] bg-gradient-to-br from-blue-400 via-violet-500 to-fuchsia-500 p-[1.5px] text-left",
        "shadow-[0_18px_40px_-16px_rgba(99,102,241,0.65)]",
        "transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.99] motion-reduce:transition-none",
        className,
      )}
    >
      <span className="relative isolate flex min-h-[8.25rem] items-center gap-3.5 overflow-hidden rounded-[calc(1.75rem-1.5px)] bg-[#0b1020] p-4 text-white">
        {/* the field: blue and violet light on deep navy, painted once */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(90% 120% at 0% 100%, rgba(37,99,235,0.55) 0%, transparent 62%), radial-gradient(80% 120% at 100% 0%, rgba(168,85,247,0.55) 0%, rgba(217,70,239,0.18) 45%, transparent 72%), linear-gradient(135deg, #0f1733 0%, #1a1245 100%)",
          }}
        />
        {/* a still sheen across the top edge */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-white/[0.09] to-transparent" />

        <span
          aria-hidden
          className="relative flex h-[3.4rem] w-[3.4rem] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 shadow-[0_10px_24px_-8px_rgba(124,58,237,0.9)] ring-4 ring-white/15"
        >
          <Wand2 className="h-[1.5rem] w-[1.5rem] text-white" />
          <Spark className="absolute -right-2 -top-2 h-3.5 w-3.5 text-fuchsia-300" />
          <Spark className="absolute -bottom-1.5 -left-2 h-2.5 w-2.5 text-sky-300" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[1.3rem] font-extrabold leading-tight tracking-[-0.02em]">
            Frenz <span className="text-gradient">AI</span>
          </span>
          {/* one still line (the 2026-10-09 refinement); the tool names live on /ai */}
          <span className="mt-1 block text-[13px] leading-snug text-white/75">Create amazing videos with AI</span>
        </span>

        {/* the button: white on a dark card, with its own violet glow — the loudest pixels on the page */}
        <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-white pl-4 pr-3 text-[14px] font-bold text-slate-900 shadow-[0_8px_24px_-6px_rgba(168,85,247,0.8)] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">
          Try now
          <ArrowRight className="h-4 w-4 text-violet-600" aria-hidden />
        </span>

        {playsMedia ? <AiPromoLoader promo={promo!} /> : null}
      </span>
    </Link>
  );
}

/**
 * A four-point sparkle.
 *
 * Its own component so the three instances share one path definition, and a
 * bare `<svg>` rather than a lucide icon because lucide's sparkle is a
 * three-star composite — at 8px that renders as a smudge. This is one curve.
 *
 * `aria-hidden` is on the wrapper, not here: the whole decorative layer is
 * hidden from assistive technology in one place.
 */

function Spark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M12 0c.6 6.2 5.2 10.8 12 12-6.8 1.2-11.4 5.8-12 12-.6-6.2-5.2-10.8-12-12 6.8-1.2 11.4-5.8 12-12z" />
    </svg>
  );
}

/**
 * Explore Features, as a full-width bar under the pair.
 *
 * It kept a whole tile when it was one of two things on this row. Below two
 * doors it is a signpost, and a signpost is a line — which is exactly the
 * "horizontal rectangular shape to full the section width" the owner drew.
 */
export function ExploreFeaturesBar({
  className,
  /**
   * ── 🔴 `tile` IS THE LANDING PAGE'S SHAPE (owner, 2026-09-09) ────────────
   *
   * "the landing page should show the features button in place of the ai
   * button as it was before the ai button was implemented."
   *
   * On the landing page this sits in the square slot beside Wallpapers, which
   * is where it lived before Frenz AI took that slot in September. On the
   * signed-in download page it stays the full-width `bar` beneath the pair.
   *
   * One component with two shapes rather than two components: the destination,
   * the copy and the brand treatment are identical, and the thing that differs
   * is the box it has to fill. Two components would drift.
   */
  variant = "bar",
}: {
  className?: string;
  variant?: "bar" | "tile";
}) {
  const tile = variant === "tile";

  return (
    <Link
      href="/features"
      className={cn(
        "group relative overflow-hidden bg-white text-slate-900",
        "ring-1 ring-inset ring-slate-900/[0.07] dark:bg-[#0b1020] dark:text-white dark:ring-white/10",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        tile
          ? /*
              ── 🔴 THE EXACT SHELL OF THE TILE IT STANDS IN FOR ──────────────

              Owner, 2026-09-09: "the wallpaper and features button isn't as it
              was before, the shape is now more rectangular, and the features
              button no longer have the gradient like the Frenz AI button."

              Both halves were mine. My first tile was `rounded-[1.25rem]` with
              no minimum height, so it collapsed to its content and sat shorter
              and squarer than the Wallpapers tile beside it — which is the
              "more rectangular" pair the owner is looking at. And it was flat
              white, where every other tile in that row carries colour.

              These are `FrenzAICta`'s own values, copied deliberately rather
              than approximated: same `min-h-[11rem]`, same `rounded-3xl`, same
              padding, same two-shadow bloom. A tile that stands in for another
              tile has to be the same object, or the row reads as assembled.
            */
            "flex min-h-[11rem] w-full flex-col rounded-3xl p-4 text-left shadow-[0_10px_30px_-14px_rgba(15,23,42,0.22)]"
          : /* The BAR: one row, y-padding 2 (owner, 2026-09-14: "is supposed to fit in and have a just y axis padding of 2"). */
            "flex w-full items-center gap-3 rounded-2xl px-4 py-2 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)]",
        className,
      )}
      /*
        🔴 AN INLINE minHeight, BECAUSE THE UTILITY CLASS IS INERT HERE.

        Owner, 2026-09-09: "the wallpaper and ai features button in the landing
        page is still shorter [than] the button in download page."

        The note above records the measurement: `min-h-[11rem]` is on this
        element, its rule is in the built CSS, the selector matches — and
        `getComputedStyle(tile).minHeight` is `0px` inside this grid. So every
        tile in that row has been sized by its CONTENT, and the landing tile is
        shorter for the honest reason that it holds less.

        An inline style is not a preference over the class; it is the one form
        of this rule that survives whatever is defeating the utility. All three
        tiles carry the identical value, so the row is the same height on both
        pages by construction rather than by whichever happens to have the most
        words in it.
      */
      // 🔴 The TILE only. This applied to the bar too and made the full-width
      // "Explore Features" row eleven rem tall (owner, 2026-09-14 screenshot).
      style={tile ? { minHeight: "11rem" } : undefined}
    >
      {/*
        ── 🔴 THE GRADIENT, AS A STATIC WASH ────────────────────────────────

        The AI tile's colour comes from three transform-animated gradient
        layers. This one takes the same palette and paints it ONCE, with no
        animation at all — and that is the right trade rather than a lesser
        one. The animated field is Frenz AI's own identity, and repeating it
        here would make two different destinations look like the same product.

        It is also the landing page, held to 1.6 seconds: a second animated
        ambient in the same row is compositor work on every frame for a tile
        nobody is looking at. Painted once, this costs nothing after first
        paint.
      */}
      {tile ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 12% 0%, rgba(37,99,235,0.22) 0%, transparent 60%)," +
              "radial-gradient(110% 85% at 92% 100%, rgba(124,58,237,0.20) 0%, transparent 62%)," +
              "linear-gradient(140deg, rgba(255,255,255,0.55) 0%, transparent 45%)",
          }}
        />
      ) : null}

      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25",
          tile ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <Compass className={tile ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"} />
      </span>

      {/* `mt-auto` pushes the label to the bottom of the tile, which is how the
          Frenz AI and Wallpapers tiles are laid out — icon top, words bottom. */}
      <span className={cn("relative min-w-0", tile ? "mt-auto block pt-3" : "flex-1")}>
        <span className={cn("block font-bold leading-tight", tile ? "text-[15px]" : "text-sm")}>
          Explore Features
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-white/60">
          See everything Frenz can do.
        </span>
      </span>

      {/* The arrow is the bar's affordance. In the tile the whole card is the
          target and a chevron in the corner would just be furniture. */}
      {tile ? null : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
          <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
        </span>
      )}
    </Link>
  );
}
