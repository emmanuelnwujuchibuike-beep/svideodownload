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
export function WallpaperCta({ className }: { className?: string }) {
  return (
    <Link
      href="/wallpapers"
      prefetch
      className={cn(
        "frenz-wp group relative isolate flex w-full items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 text-left",
        "text-white ring-1 ring-inset ring-white/15",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        className,
      )}
    >
      {/*
        ── The colour is a CLIPPED LAYER, with no radius of its own ────────────
        Owner, 2026-08-09: "the wallpaper button isn't trimmed well in the
        button's rounded [corners], the colours are spilling at the edge, make
        the colour to have zero border radius."

        Exactly right, and there were two spills:

        1. An outer bloom at `-inset-1` with `rounded-3xl` sat behind a
           `rounded-2xl` button — a BIGGER box with a BIGGER radius, so its
           corners bulged past the button's own. `-z-10` also pushed it outside
           the parent's paint order, where `overflow-hidden` no longer reliably
           trimmed it.
        2. A `shadow-violet-500/30` glow throws colour in every direction by
           definition, and a shadow is never clipped by the parent's radius.

        Both are gone. The gradient is now a plain `inset-0` layer with NO
        border radius at all — the parent's `overflow-hidden rounded-2xl` is the
        only thing that decides the shape, so the colour cannot disagree with it.
        `isolate` keeps the layer in this element's own stacking context rather
        than escaping behind it.

        Depth now comes from a neutral shadow, which casts grey rather than
        violet and so reads as lift instead of leakage.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600"
      />
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
