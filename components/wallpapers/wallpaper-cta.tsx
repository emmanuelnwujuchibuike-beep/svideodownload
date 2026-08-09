import { ArrowRight, Image as ImageIcon, Microscope } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The "Wallpaper Gallery" entry tile — landing hero and the signed-in downloads
 * dashboard.
 *
 * ── One component, because there were two copies (2026-08-09) ────────────────
 * The same ~30 lines of markup lived in `components/landing/hero.tsx` and in
 * `features/downloads/downloads-page.tsx`, with the second added later as a
 * deliberate copy of the first. Two copies of a styled CTA is how "I changed the
 * button and it still looks the same" happens — you change the branch the owner
 * is not looking at. Collapsed to one.
 *
 * ── Filled, not outlined (owner, 2026-08-09) ─────────────────────────────────
 * "make the wallpaper button in the landing page and download page to be more
 * visible with a more visible premium color."
 *
 * It was a white card with a violet icon, sitting directly beneath a white
 * "Explore Features" card on the landing and a white paste box on the dashboard
 * — so the one row meant to advertise a whole feature read as the least
 * important thing on screen. It is now a filled violet→fuchsia gradient with
 * white type and a coloured glow.
 *
 * Violet/fuchsia rather than the brand blue ON PURPOSE. The primary action on
 * both surfaces is the blue Download CTA; painting this the same blue would make
 * two competing primaries and cost the download button its emphasis. A different
 * premium hue reads as "the other thing you can do here", which is what it is.
 *
 * ── Zero client JavaScript ───────────────────────────────────────────────────
 * A plain server-rendered `Link`. The landing page has no headroom in its
 * cold-entry budget — an earlier version of this row was a client island that
 * warmed the route on idle and pushed the page through the ceiling on its own
 * (budget.test caught it at 303 kB). The dwell flourish, the sheen and the
 * "View" cue are all CSS (`.frenz-wp-*` in globals.css) on a 2s delay, and
 * `prefetch` plus `/wallpapers`'s own `loading.tsx` is what makes the tap
 * instant. Nothing here hydrates. Keep it that way.
 */
export function WallpaperCta({
  className,
  /**
   * `row` — the full-width row used on the downloads dashboard.
   * `card` — the tall two-column tile from `public/landing hero section.jpg`:
   *          icon tile top-left, VIEW pill top-right, title and sub stacked
   *          below, circular arrow bottom-right.
   *
   * Same component either way, so the icon, the dwell flourish, the sheen and
   * the VIEW cue cannot drift between the two surfaces — which is exactly what
   * happened when this markup existed twice.
   */
  variant = "row",
}: {
  className?: string;
  variant?: "row" | "card";
}) {
  if (variant === "card") return <WallpaperCard className={className} />;
  return (
    <Link
      href="/wallpapers"
      prefetch
      /*
        ── The colour is the element's OWN BACKGROUND ─────────────────────────
        Owner, 2026-08-09: "the colours are spilling at the edge, make the
        colour to have zero border radius." Then, after the first attempt: the
        button rendered with no text at all.

        Both symptoms, and why this shape is the right one:

        1. THE SPILL. There were two sources, and neither was the background.
           An outer bloom at `-inset-1` with `rounded-3xl` sat behind a
           `rounded-2xl` button — a BIGGER box with a BIGGER radius, so its
           corners bulged past the button's own. And `shadow-violet-500/30`
           throws colour in every direction by definition; a shadow is never
           clipped by a border radius. Both are gone.

        2. THE MISSING TEXT — my own regression. Moving the gradient into an
           `absolute inset-0` CHILD made it a POSITIONED element, and positioned
           elements paint above static siblings. So the colour layer covered the
           title and the subtitle. (The icon and the "VIEW" cue survived only
           because their CSS animations apply a transform, which promotes them.)

        A `background-image` on the element itself has neither problem: a
        background is always painted behind its own content, and it is clipped
        by `border-radius` for free. There is no layer to disagree about the
        shape and nothing to paint over the words.
      */
      className={cn(
        "frenz-wp group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 text-left",
        "bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white",
        "ring-1 ring-inset ring-white/15 shadow-md",
        "transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.995]",
        className,
      )}
    >
      <span className="frenz-wp-icon relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
        <ImageIcon className="relative h-5 w-5" />
        <span
          aria-hidden
          className="frenz-wp-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-bold leading-tight text-white">Wallpaper Gallery</span>
          {/*
            The dwell cue (owner, 2026-08-09: "when a user stays at the button
            section for 2 secs, the wallpaper icon should animate premium
            attractive, writing a small text that says view with a microscope").

            A real label for what the tile does, not decoration — so
            `prefers-reduced-motion` keeps the words and drops only the movement.
          */}
          <span className="frenz-wp-cue inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white ring-1 ring-inset ring-white/30">
            <Microscope className="h-3 w-3" />
            View
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-white/80">Stunning quality, updated daily</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-white/90 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * The tall two-column tile from `public/landing hero section.jpg`.
 *
 * Same content and the SAME animations as the row — icon tile, dwell flourish,
 * sheen, VIEW cue — rearranged into the reference's shape: icon top-left, VIEW
 * top-right, title and sub-line stacked, a circular arrow bottom-right.
 *
 * The gradient is again the element's own background, for the reason recorded
 * on the row above: a positioned colour layer paints over its own text, and a
 * background is clipped by `border-radius` for free.
 */
function WallpaperCard({ className }: { className?: string }) {
  return (
    <Link
      href="/wallpapers"
      prefetch
      className={cn(
        "frenz-wp group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        "bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white",
        "ring-1 ring-inset ring-white/15 shadow-md",
        "transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.995]",
        className,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="frenz-wp-icon relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/20 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
          <ImageIcon className="relative h-6 w-6" />
          <span
            aria-hidden
            className="frenz-wp-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
          />
        </span>
        {/* The 2-second dwell cue, in the reference's top-right position. */}
        <span className="frenz-wp-cue inline-flex items-center gap-1 rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white ring-1 ring-inset ring-white/30">
          <Microscope className="h-3 w-3" />
          View
        </span>
      </span>

      <span className="mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight text-white">Wallpaper Gallery</span>
          <span className="mt-1 block text-xs leading-snug text-white/80">Stunning quality, updated daily</span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/25 transition group-hover:bg-white/30">
          <ArrowRight className="h-4 w-4 text-white transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}
