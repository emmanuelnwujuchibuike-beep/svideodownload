"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

import { FrenzMark } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * Login collage — a floating gallery of real photos that "morph" into place
 * (PowerPoint-style: each tile springs up, rotates and settles, then drifts
 * gently). Tiles are laid out with minimal overlap so every image reads clearly,
 * and all sources are eager (`priority`) so they arrive together instead of
 * popping in one-by-one.
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
  { img: "2.png", grad: "from-violet-500 to-fuchsia-700", pos: { top: "6%", left: "35%", width: "30%", height: "44%" }, rotate: 0, z: "z-20" },
  // top-left — paint splash
  { img: "1.png", grad: "from-indigo-500 to-violet-700", pos: { top: "0%", left: "3%", width: "29%", height: "30%" }, rotate: -5 },
  // top-right — circuit globe
  { img: "4.png", grad: "from-blue-600 to-violet-700", pos: { top: "2%", left: "68%", width: "29%", height: "30%" }, rotate: 5 },
  // mid-left — music note
  { img: "3.png", grad: "from-purple-500 to-violet-800", pos: { top: "36%", left: "1%", width: "30%", height: "30%" }, rotate: -3 },
  // mid-right — blue geometric
  { img: "6.png", grad: "from-fuchsia-600 to-purple-800", pos: { top: "36%", left: "69%", width: "30%", height: "30%" }, rotate: 4 },
  // bottom-left — neon rock
  { img: "7.png", grad: "from-violet-600 to-indigo-800", pos: { top: "66%", left: "12%", width: "30%", height: "32%" }, rotate: 3 },
  // bottom-right — social chains
  { img: "5.png", grad: "from-purple-600 to-fuchsia-800", pos: { top: "64%", left: "55%", width: "30%", height: "32%" }, rotate: -4 },
];

export function LoginCollage() {
  return (
    <div className="relative mx-auto aspect-[10/11] h-full max-h-[46vh] w-full max-w-[420px]">
      {TILES.map((t, i) => (
        <motion.div
          key={t.img}
          className={cn("absolute", t.z)}
          style={{ top: t.pos.top, left: t.pos.left, width: t.pos.width, height: t.pos.height }}
          initial={{ opacity: 0, scale: 0.55, rotate: t.rotate - 10, y: 18 }}
          animate={{ opacity: 1, scale: 1, rotate: t.rotate, y: 0 }}
          transition={{ delay: 0.05 + i * 0.09, type: "spring", stiffness: 140, damping: 15 }}
        >
          {/* Inner wrapper drifts forever (motion-safe) once it has settled */}
          <div className={cn("relative h-full w-full overflow-hidden rounded-[22px] bg-gradient-to-br shadow-xl ring-1 ring-inset ring-white/15", t.grad, i % 2 ? "motion-safe:animate-drift" : "motion-safe:animate-drift-slow")}>
            <Image src={`/login/${t.img}`} alt="" aria-hidden fill sizes="180px" quality={70} priority className="object-cover" />
            {/* Subtle depth: soft top light + bottom shade, no badges */}
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/5" />
          </div>
        </motion.div>
      ))}

      {/* Center brand mark — springs in last, sits in the clear central gap, and
          doubles as a button back to the landing page. */}
      <motion.div
        className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05 + TILES.length * 0.09, type: "spring", stiffness: 200, damping: 14 }}
      >
        <Link href="/" aria-label="Frenz home" className="block rounded-[22px] transition-transform duration-200 hover:scale-105 active:scale-95">
          <FrenzMark size={68} className="drop-shadow-2xl motion-safe:animate-drift-slow" />
        </Link>
      </motion.div>
    </div>
  );
}
