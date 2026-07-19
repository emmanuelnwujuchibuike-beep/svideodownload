"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * Login collage — a floating gallery of real photos that "morph" into place
 * (PowerPoint-style: each tile springs up, rotates and settles, then drifts
 * gently). Tiles are laid out with minimal overlap so every image reads clearly,
 * Sources are 640px WebP (converted from 9.5MB of PNG — see README), and only
 * the centre hero is `priority`: preloading all seven made them compete for the
 * same connection and none arrived early.
 */
type Tile = {
  img: string;
  grad: string;
  pos: { top: string; left: string; width: string; height: string };
  rotate: number;
  z?: string;
};

const TILES: Tile[] = [
  // center hero — clock girl (portrait)
  { img: "2.webp", grad: "from-violet-500 to-fuchsia-700", pos: { top: "6%", left: "35%", width: "30%", height: "44%" }, rotate: 0, z: "z-20" },
  // top-left — paint splash
  { img: "1.webp", grad: "from-indigo-500 to-violet-700", pos: { top: "0%", left: "3%", width: "29%", height: "30%" }, rotate: -5 },
  // top-right — circuit globe
  { img: "4.webp", grad: "from-blue-600 to-violet-700", pos: { top: "2%", left: "68%", width: "29%", height: "30%" }, rotate: 5 },
  // mid-left — music note
  { img: "3.webp", grad: "from-purple-500 to-violet-800", pos: { top: "36%", left: "1%", width: "30%", height: "30%" }, rotate: -3 },
  // mid-right — blue geometric
  { img: "6.webp", grad: "from-fuchsia-600 to-purple-800", pos: { top: "36%", left: "69%", width: "30%", height: "30%" }, rotate: 4 },
  // bottom-left — neon rock
  { img: "7.webp", grad: "from-violet-600 to-indigo-800", pos: { top: "66%", left: "12%", width: "30%", height: "32%" }, rotate: 3 },
  // bottom-right — social chains
  { img: "5.webp", grad: "from-purple-600 to-fuchsia-800", pos: { top: "64%", left: "55%", width: "30%", height: "32%" }, rotate: -4 },
];

export function LoginCollage() {
  return (
    /*
      NO `h-full` — it was measured as the single largest layout shift in the app.
      /login scored CLS 0.1614 (POOR) on slow 4G + 4x CPU, and the layout-shift
      entry named exactly this element, firing ~1.8-2.1s in.

      Why: this sits in a `flex-1` column whose height is whatever is left after
      the auth block below it. That block contains the big gradient headline, so
      when the webfont swaps in, the headline reflows, the leftover space changes,
      and `h-full` drags the whole collage with it.

      Dropping it lets `aspect-[10/11]` derive height from WIDTH, which is known at
      first paint and never changes. `max-h-[46vh]` still caps it, and vh is also
      known immediately — so the box has a stable size before any font or image
      arrives. The visual result is unchanged; only the dependency is.
    */
    <div className="relative mx-auto aspect-[10/11] max-h-[46vh] w-full max-w-[420px]">
      {TILES.map((t, i) => {
        const isHero = i === 0;

        // A plain <img> straight at the WebP — see the note below Tile().
        const img = (
          <img
            src={`/login/${t.img}`}
            alt=""
            aria-hidden
            loading={isHero ? "eager" : "lazy"}
            fetchPriority={isHero ? "high" : "auto"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        );
        const inner = (
          <div
            className={cn(
              "relative h-full w-full overflow-hidden rounded-[22px] bg-gradient-to-br shadow-xl ring-1 ring-inset ring-white/15",
              t.grad,
              i % 2 ? "motion-safe:animate-drift" : "motion-safe:animate-drift-slow",
            )}
          >
            {img}
            {/* Subtle depth: soft top light + bottom shade, no badges */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/5"
            />
          </div>
        );

        /*
          THE LCP TILE IS NOT ANIMATED IN.

          Every tile used to be a `motion.div` with `initial={{ opacity: 0 }}`.
          framer-motion writes that initial state into the SSR HTML as an inline
          `opacity: 0`, so the centre hero — which is the LCP element — was
          painted at ZERO opacity until JS hydrated and ran its entrance spring.
          LCP measures when an element becomes VISIBLE, so it could not fire
          until hydration finished: measured live at 8-11s on slow 4G + 4x CPU,
          while the 68KB image itself and FCP were both ~1-3s. The image was
          never the bottleneck; a JS-gated opacity was.

          The hero now renders as a plain div at full opacity, so it is visible
          in the server HTML and its LCP is gated only by the image arriving. It
          keeps the perpetual drift (CSS, not JS). The other six still spring in
          — they are not LCP candidates, so animating them costs nothing that
          matters.
        */
        if (isHero) {
          return (
            <div
              key={t.img}
              className={cn("absolute", t.z)}
              style={{ top: t.pos.top, left: t.pos.left, width: t.pos.width, height: t.pos.height, transform: `rotate(${t.rotate}deg)` }}
            >
              {inner}
            </div>
          );
        }

        return (
          <motion.div
            key={t.img}
            className={cn("absolute", t.z)}
            style={{ top: t.pos.top, left: t.pos.left, width: t.pos.width, height: t.pos.height }}
            initial={{ opacity: 0, scale: 0.55, rotate: t.rotate - 10, y: 18 }}
            animate={{ opacity: 1, scale: 1, rotate: t.rotate, y: 0 }}
            transition={{ delay: 0.05 + i * 0.09, type: "spring", stiffness: 140, damping: 15 }}
          >
            {inner}
          </motion.div>
        );
      })}
    </div>
  );
}
