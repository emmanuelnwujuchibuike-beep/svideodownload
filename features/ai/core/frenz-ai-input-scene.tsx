import { Sparkle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The small scene beside the headline on the input page.
 *
 * Built from `public/ai input page.jpg`: a stack of glass video cards angled
 * back, a white play button on the front one, an "AI" chip at the top right, a
 * sparkle, and a light arc sweeping behind the group.
 *
 * ── Why it is `aria-hidden` and sized in percentages ────────────────────────
 *
 * It says nothing the headline beside it does not already say, so it is
 * decoration and is hidden from assistive technology rather than described.
 * And it shares the row with the copy, so it is sized relative to that row —
 * fixed pixels would collide with the headline on a narrow phone, which is the
 * one place this page has to be perfect.
 *
 * Drawn in CSS. No photograph on a screen whose whole job is to get somebody to
 * pick a file quickly; see the note in frenz-ai-before-after-scene.tsx.
 *
 * Only the arc and the sparkle move, on long cycles, stopping under
 * `prefers-reduced-motion` and on a hidden tab.
 */
export function FrenzAIInputScene({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none relative", className)}>
      {/* the glow the group sits in */}
      <span
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 60% at 55% 45%, rgba(129,140,248,0.30) 0%, transparent 72%)," +
            "radial-gradient(50% 50% at 85% 25%, rgba(217,70,239,0.22) 0%, transparent 70%)",
        }}
      />

      {/* the arc sweeping behind */}
      <svg viewBox="0 0 200 160" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          {/*
            🔴 `userSpaceOnUse`. On a stroked arc the default objectBoundingBox
            ties the ramp to each path's own box, so two arcs of different sizes
            get different colour — and on a perfectly flat path the box has zero
            area and the stroke paints NOTHING at all. This project has already
            lost time to that one.
          */}
          <linearGradient id="fai-arc" gradientUnits="userSpaceOnUse" x1="10" y1="30" x2="190" y2="130">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="45%" stopColor="#818cf8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#e879f9" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <g className="frenz-ai-orbit" style={{ transformOrigin: "100px 82px" }}>
          <ellipse
            cx="100"
            cy="82"
            rx="86"
            ry="42"
            fill="none"
            stroke="url(#fai-arc)"
            strokeWidth="2.5"
            strokeLinecap="round"
            transform="rotate(-18 100 82)"
          />
        </g>
      </svg>

      {/* the stack: two cards behind, one in front */}
      <span className="absolute left-[6%] top-[34%] h-[38%] w-[42%] -rotate-[10deg] rounded-2xl bg-indigo-400/20 ring-1 ring-inset ring-white/40" />
      <span className="absolute left-[18%] top-[28%] h-[42%] w-[46%] -rotate-[5deg] rounded-2xl bg-indigo-400/25 ring-1 ring-inset ring-white/45" />

      <span className="absolute left-[32%] top-[24%] flex h-[48%] w-[52%] items-center justify-center rounded-2xl bg-gradient-to-br from-sky-300/45 via-indigo-400/35 to-violet-500/30 ring-1 ring-inset ring-white/55 shadow-[0_18px_44px_-20px_rgb(79_70_229/0.85)]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/92 shadow-[0_6px_16px_-4px_rgb(30_27_75/0.55)]">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-indigo-600">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>

      {/* the AI chip */}
      <span className="absolute right-0 top-[6%] rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_10px_24px_-8px_rgb(217_70_239/0.9)]">
        AI
      </span>

      <span className="frenz-ai-twinkle absolute left-[10%] top-[12%] text-sky-400">
        <Sparkle className="h-4 w-4 fill-current" />
      </span>
    </div>
  );
}
