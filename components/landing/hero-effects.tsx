import { Cloud, Download, Music, Users } from "lucide-react";

/**
 * The hero's ambient effects — orbital light trails, neon glow, drifting particles
 * and floating glass product tiles, matching `public/main landing page.jpg`.
 *
 * ── Constraints this had to satisfy ────────────────────────────────────────────
 *
 * 1. ZERO images and zero JS. `/` is a static page under a 2-second cold-entry
 *    budget whose LCP already measures ~2.0s on slow-4G + 4x CPU. Every effect here
 *    is a CSS gradient, a border or an SVG stroke — nothing to download, nothing to
 *    decode, no hydration cost. A single 200KB "neon swirl" PNG would have blown
 *    the budget on its own.
 *
 * 2. COMPOSITOR-ONLY animation. Everything animated is `transform` or `opacity`, so
 *    frames never touch layout or paint. No `filter` animation, no `box-shadow`
 *    animation — both repaint every frame and cook a mid-range phone's battery,
 *    which this project explicitly cares about.
 *
 * 3. NO `will-change`. Deliberate, and load-bearing: `will-change: transform`
 *    creates a permanent CONTAINING BLOCK, which is what previously broke
 *    `position: fixed` descendants (the nav menu's unlimited height and the
 *    bottom-nav-in-chat bug, removed in 135ed36). These layers sit behind the hero
 *    where a fixed element could easily end up; the compositor promotes them from
 *    the animation itself without the side effect.
 *
 * 4. Honours `prefers-reduced-motion` — all motion stops, the composition stays.
 *
 * Entirely decorative: `aria-hidden`, `pointer-events-none`, and it contributes no
 * layout so nothing downstream shifts (CLS stays flat).
 */

/** Product tiles that float around the device, as in the mockup. */
const TILES = [
  { icon: Download, className: "left-[2%] top-[8%]", tint: "from-blue-500/90 to-indigo-600/90", delay: "0s" },
  { icon: Users, className: "left-[-4%] top-[46%]", tint: "from-fuchsia-500/90 to-violet-600/90", delay: "-2.5s" },
  { icon: Cloud, className: "right-[0%] top-[16%]", tint: "from-violet-500/90 to-purple-600/90", delay: "-1.2s" },
  { icon: Music, className: "right-[2%] bottom-[16%]", tint: "from-sky-500/90 to-blue-600/90", delay: "-3.6s" },
];

export function HeroEffects() {
  return (
    /*
     * z-0, NOT -z-10. A negative z-index puts this behind the section's own
     * background-color, which then paints straight over every effect — the first
     * build rendered a flat navy block with no trails at all. The section paints
     * its ground, this layer sits above it, and the hero content sits above both
     * with `relative z-10`.
     */
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Deep-space wash. The mockup's page is near-black with a violet bloom. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_20%,rgba(76,29,149,0.45)_0%,rgba(30,27,75,0.35)_35%,transparent_70%)]" />

      {/* Orbital light trails. Three ellipses at different tilts and speeds; the
          conic gradient makes the stroke brighten along its length, which is what
          reads as light travelling around the ring rather than a static outline. */}
      <div className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 sm:h-[46rem] sm:w-[46rem]">
        {[
          { size: "inset-0", spin: "frenz-orbit-slow", tilt: "rotate-[18deg]" },
          { size: "inset-[8%]", spin: "frenz-orbit-mid", tilt: "-rotate-[24deg]" },
          { size: "inset-[18%]", spin: "frenz-orbit-fast", tilt: "rotate-[62deg]" },
        ].map((ring) => (
          <span
            key={ring.spin}
            className={`absolute ${ring.size} ${ring.tilt} rounded-[50%] ${ring.spin}`}
            style={{
              // A conic gradient masked to the ring edge: bright arc, fading tail.
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(59,130,246,0.55) 40deg, rgba(168,85,247,0.65) 90deg, transparent 170deg, transparent 360deg)",
              WebkitMask: "radial-gradient(closest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
              mask: "radial-gradient(closest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
            }}
          />
        ))}
      </div>

      {/* Neon bloom behind the device. */}
      <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.35)_0%,rgba(59,130,246,0.18)_45%,transparent_70%)] blur-2xl" />

      {/* Drifting particles. A repeating-gradient starfield rather than N elements —
          one node instead of forty, and it scales to any viewport for free. */}
      <div
        className="frenz-drift absolute inset-0 opacity-60"
        style={{
          backgroundImage: [
            "radial-gradient(1.5px 1.5px at 12% 22%, rgba(255,255,255,0.65) 50%, transparent 51%)",
            "radial-gradient(1.5px 1.5px at 68% 14%, rgba(191,219,254,0.6) 50%, transparent 51%)",
            "radial-gradient(1px 1px at 34% 71%, rgba(255,255,255,0.5) 50%, transparent 51%)",
            "radial-gradient(1.5px 1.5px at 84% 62%, rgba(216,180,254,0.6) 50%, transparent 51%)",
            "radial-gradient(1px 1px at 52% 38%, rgba(255,255,255,0.45) 50%, transparent 51%)",
            "radial-gradient(1px 1px at 8% 84%, rgba(191,219,254,0.5) 50%, transparent 51%)",
          ].join(","),
          backgroundSize: "100% 100%",
        }}
      />

      {/* Floating glass product tiles. */}
      {TILES.map(({ icon: Icon, className, tint, delay }, i) => (
        <span
          key={i}
          className={`frenz-float absolute ${className} hidden lg:flex`}
          style={{ animationDelay: delay }}
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${tint} text-white shadow-[0_8px_32px_rgba(88,28,135,0.45)] ring-1 ring-white/20 backdrop-blur-sm`}
          >
            <Icon className="h-6 w-6" />
          </span>
        </span>
      ))}
    </div>
  );
}
