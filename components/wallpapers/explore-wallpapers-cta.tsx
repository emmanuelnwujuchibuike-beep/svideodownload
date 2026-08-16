import { ArrowRight, Image as ImageIcon } from "lucide-react";
import Link from "next/link";

/**
 * "Explore wallpapers" — the premium gradient pill CTA into `/wallpapers`.
 *
 * Extracted from `components/landing/product-grid.tsx` (owner, 2026-08-16:
 * "let the download page share same wallpaper button with the landing
 * page") so both surfaces render the exact same markup — a class of bug
 * this codebase has hit before with `WallpaperCta`'s card/row variants (see
 * that component's own history note): two copies of a styled CTA is how
 * "I changed the button and it still looks the same" happens, because the
 * change lands on the copy nobody is looking at.
 *
 * Zero client JavaScript, matching `WallpaperCta` — a plain server-rendered
 * `Link`, safe to drop into any page's budget.
 *
 * ── The glow lives outside the clipped button (owner, 2026-08-16, with a
 * screenshot: "this wallpaper button has some color edges that dont have
 * border radius") ──
 * The blurred glow span is a SIBLING before the `<Link>`, not a child of it.
 * The `<Link>` has `overflow-hidden rounded-2xl`, so in spec-correct CSS a
 * child glow's `-inset-1` overhang should already clip flush to the
 * button's own rounded corners — but iOS Safari has a long-standing bug
 * where a `filter: blur()` child can escape an ancestor's `overflow:
 * hidden` clip specifically at the corners, which is the exact "square-ish
 * color bleeding past a rounded corner" artifact reported. Putting the glow
 * outside anything that needs to clip it sidesteps the WebKit quirk
 * entirely rather than chasing it.
 *
 * ── The 2-second premium cue (owner, 2026-08-16: "the wallpaper button in
 * the download page still doesnt change after 2 sec like the landing
 * page") ──
 * `WallpaperCta`'s own tile has a signature dwell flourish: two seconds
 * after it paints, its icon does a small scale/rotate pop and a light sweep
 * travels across it once (twice, technically — `.frenz-wp-icon`/
 * `.frenz-wp-sheen` in globals.css, `animation: … 2s 2 both`) — an
 * attention cue for a visitor who has landed but not acted yet, replayed on
 * hover for anyone who arrives late. This pill never had it (it only ever
 * swept on hover), so it read as inconsistent with the OTHER wallpaper
 * button on the same pages. Reusing the same `frenz-wp*` keyframes (they
 * only animate transform, so they're not tied to WallpaperCta's specific
 * markup) makes both buttons share the one cue instead of one having it
 * and one not — the "changes after 2 sec" IS this animation.
 */
export function ExploreWallpapersCta({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex justify-center"}>
      <div className="relative inline-flex">
        <span aria-hidden className="pointer-events-none absolute -inset-1 -z-10 rounded-3xl bg-gradient-to-r from-blue-500 to-fuchsia-500 opacity-40 blur-md" />
        <Link
          href="/wallpapers"
          prefetch
          className="frenz-wp group relative inline-flex items-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 active:scale-[0.98]"
        >
          <span aria-hidden className="frenz-wp-sheen pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <span className="frenz-wp-icon relative inline-flex">
            <ImageIcon className="relative h-4 w-4" />
          </span>
          <span className="relative">Explore wallpapers</span>
          <ArrowRight className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
