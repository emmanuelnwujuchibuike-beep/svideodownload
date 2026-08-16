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
 */
export function ExploreWallpapersCta({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex justify-center"}>
      <div className="relative inline-flex">
        <span aria-hidden className="pointer-events-none absolute -inset-1 -z-10 rounded-3xl bg-gradient-to-r from-blue-500 to-fuchsia-500 opacity-40 blur-md" />
        <Link
          href="/wallpapers"
          prefetch
          className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 active:scale-[0.98]"
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full" />
          <ImageIcon className="relative h-4 w-4" />
          <span className="relative">Explore wallpapers</span>
          <ArrowRight className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
