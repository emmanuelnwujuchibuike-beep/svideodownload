import { ArrowRight, Compass, Wand2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI TILE — the landing/download pair's first action
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "Replace the features button with the frenz Ai button and
 * move the features button below the Frenz AI and wallpaper button below in
 * horizontal rectangular shape to full the section width."
 *
 * So the top row becomes [ Frenz AI | Wallpapers ] and Explore Features drops
 * beneath them as a full-width bar. Frenz AI takes the position Features held
 * because it is the newest thing the product does and the one the owner is
 * pushing; Features is a directory, and a directory can sit below the doors.
 *
 * ── Deliberately the same shape as the tile it replaces ─────────────────────
 *
 * Same height, same radius, same shadow, same icon-then-label-then-arrow
 * rhythm as the Wallpapers tile it now sits beside. A new tile that introduced
 * its own proportions would make the pair look assembled rather than designed.
 * What differs is the colour: this one carries the AI gradient, so the eye
 * lands on it first without it being physically larger.
 *
 * ── Cheap, because this is a 1.6-second route ───────────────────────────────
 *
 * A server component with no image, no blur and no animation beyond a hover
 * transform. The landing budget is measured in kilobytes of JS and this adds
 * none.
 */
export function FrenzAICta({
  /**
   * The background photo, from landing settings.
   *
   * 🔴 Owner, 2026-09-08: "the ai button should be this image", with a
   * cyberpunk AI-eye render attached. Art direction that specific must be
   * UPLOADABLE, not committed — it will change, and changing it should not
   * need a deploy. Empty falls back to the drawn backdrop below, so the tile
   * is never broken while the slot is empty.
   */
  imageUrl,
  className,
}: {
  imageUrl?: string;
  className?: string;
}) {
  return (
    <Link
      href="/ai"
      prefetch={false}
      className={cn(
        "group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        "bg-gradient-to-br from-[#101744] via-[#1b1560] to-[#3b1063] text-white",
        "shadow-[0_10px_30px_-10px_rgba(49,46,129,0.55)] ring-1 ring-inset ring-white/10",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        className,
      )}
    >
      {imageUrl ? (
        <>
          <Image
            src={imageUrl}
            alt=""
            aria-hidden
            fill
            /*
              A fixed hint, not a viewport fraction: this is a half-width tile
              in a two-column grid capped by the page container, so `50vw`
              would make the optimizer serve a variant several times larger
              than it is ever shown at. `quality={74}` deliberately — 75
              poisons the optimizer's cache key on this project.
            */
            sizes="(min-width: 640px) 320px, 50vw"
            quality={74}
            className="object-cover opacity-70 transition duration-500 group-hover:opacity-80 motion-reduce:transition-none"
          />
          {/* The copy has to stay readable over whatever the photo is doing. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b1030] via-[#0b1030]/55 to-transparent"
          />
        </>
      ) : (
        /* One static wash. No animation on the front door. */
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-70"
          style={{
            background:
              "radial-gradient(circle, rgba(217,70,239,0.55) 0%, rgba(99,102,241,0.25) 45%, transparent 70%)",
          }}
        />
      )}

      {/*
        🔴 A WAND, NOT A SPARKLE (owner: "the ai button icon should be something
        more related to cleaning or ai").

        A four-pointed sparkle is the generic AI glyph every product uses, and
        it says "something clever happens" rather than what. A wand is the verb:
        it is what you point at a thing to remove what you do not want, and it
        is already the badge on the AI work scene — so the two surfaces now
        share one symbol for one action.
      */}
      <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30">
        <Wand2 className="h-6 w-6" />
      </span>

      <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight">Frenz AI</span>
          <span className="mt-1 block text-xs leading-snug text-white/70">
            Remove captions and text from your videos.
          </span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/20 transition group-hover:bg-white/25">
          <ArrowRight className="h-4 w-4 text-white transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}

/**
 * Explore Features, as a full-width bar under the pair.
 *
 * It kept a whole tile when it was one of two things on this row. Below two
 * doors it is a signpost, and a signpost is a line — which is exactly the
 * "horizontal rectangular shape to full the section width" the owner drew.
 */
export function ExploreFeaturesBar({ className }: { className?: string }) {
  return (
    <Link
      href="/features"
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-slate-900",
        "shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06]",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        "dark:bg-white/[0.04] dark:text-white dark:ring-white/10",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25">
        <Compass className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-tight">Explore Features</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-white/60">
          See everything Frenz can do.
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
        <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
      </span>
    </Link>
  );
}
