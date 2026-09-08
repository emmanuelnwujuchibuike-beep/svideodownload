import { Sparkles, Wand2 } from "lucide-react";

import { FrenzAIStill } from "@/features/ai/core/frenz-ai-still";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORK SCENE — what a member looks at while the AI runs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from `public/ai progress.jpg` (owner, 2026-09-08): stacked glass video
 * cards with a play button, a swirl of light orbiting them, an "AI" chip, a
 * wand badge, and drifting spheres.
 *
 * ── 🔴 WHY THIS IS WORTH THE PIXELS ─────────────────────────────────────────
 *
 * Because the wait is long and we cannot make it shorter. The model runs on CPU
 * hardware in somebody else's account; measured on 2026-09-08, a 0.15 MB clip
 * took over ten minutes. Nothing in this repository can change that number —
 * only a GPU redeploy can (docs/replicate-gpu/).
 *
 * What CAN change is whether ten minutes feels like a product working or a page
 * that has died. A spinner says "something, somewhere, maybe". This says the
 * machine has your video and is turning it over. That is the whole job.
 *
 * ── Drawn, and cheap ────────────────────────────────────────────────────────
 *
 * Inline SVG and CSS, no images, no library.
 *
 * 🔴 EXACTLY TWO THINGS MOVE, and that number is the point. This screen had
 * NINE animations, on a surface a member stares at for the whole of a job —
 * and the owner reported the phone overheating while watching it. Every one of
 * those was a composited layer being ticked forever for decoration.
 *
 * The orbit and the front card breathing are kept because they say "this is
 * working". The badges, the spheres and the twinkles are now static: they read
 * identically in a screenshot and cost nothing per frame. Both survivors are
 * transform/opacity on long cycles and stop under `prefers-reduced-motion` and
 * on a hidden tab via `--ai-play`.
 *
 * A server component: no hooks, no state. It is rendered by a client parent,
 * which is fine — the boundary forbids passing functions, not rendering.
 */
export function FrenzAIWorkScene({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none relative mx-auto h-44 w-full max-w-sm sm:h-52", className)}
    >
      {/* ── the light behind everything ──────────────────────────────────── */}
      <span
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 55% at 50% 48%, rgba(99,102,241,0.30) 0%, transparent 70%)," +
            "radial-gradient(45% 45% at 68% 62%, rgba(217,70,239,0.22) 0%, transparent 72%)",
        }}
      />

      {/*
        ── the orbit ────────────────────────────────────────────────────────

        Two ellipses on ONE rotating group, exactly as the Core does it: a
        single composited transform for the whole swirl rather than an
        animation per ring.

        🔴 `gradientUnits="userSpaceOnUse"`. An ellipse stroke's bounding box is
        fine, but the default objectBoundingBox makes the gradient's geometry
        depend on each shape's own box, so two ellipses of different sizes would
        get visibly different colour ramps. Pinning it to user space makes the
        light one continuous field across both — and it is the same attribute
        whose absence once made a gradient paint nothing at all.
      */}
      <svg viewBox="0 0 320 200" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id="faw-swirl" gradientUnits="userSpaceOnUse" x1="20" y1="60" x2="300" y2="150">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
            <stop offset="35%" stopColor="#6366f1" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#d946ef" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f472b6" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <g className="frenz-ai-orbit" style={{ transformOrigin: "160px 108px" }}>
          <ellipse
            cx="160"
            cy="108"
            rx="118"
            ry="42"
            fill="none"
            stroke="url(#faw-swirl)"
            strokeWidth="3"
            strokeLinecap="round"
            transform="rotate(-14 160 108)"
          />
          <ellipse
            cx="160"
            cy="112"
            rx="96"
            ry="30"
            fill="none"
            stroke="url(#faw-swirl)"
            strokeWidth="2"
            strokeLinecap="round"
            transform="rotate(9 160 112)"
            opacity="0.75"
          />
        </g>
      </svg>

      {/*
        ── the stacked cards ──────────────────────────────────────────────

        🔴 All three hold the frame now (owner, 2026-09-08: "this progress card
        only have one wallpaper in one while the rest 2 crs are empty"). Two
        empty tinted rectangles behind a filled one read as the image having
        failed to load twice, which is the opposite of the reassurance this
        screen exists to give.

        It costs NOTHING extra: same url, same rendered width, so the browser
        fetches and decodes ONE image and paints it three times. They are
        progressively dimmed and desaturated so the front card still reads as
        the subject rather than the three competing.
      */}
      <span className="absolute left-[13%] top-[24%] h-24 w-28 -rotate-[10deg] overflow-hidden rounded-2xl opacity-45 ring-1 ring-inset ring-white/25">
        <FrenzAIStill sizes="112px" className="saturate-[0.7]" />
        <span aria-hidden className="absolute inset-0 bg-indigo-500/25" />
      </span>
      <span className="absolute left-[26%] top-[18%] h-28 w-32 -rotate-[4deg] overflow-hidden rounded-2xl opacity-70 ring-1 ring-inset ring-white/30">
        <FrenzAIStill sizes="128px" className="saturate-[0.85]" />
        <span aria-hidden className="absolute inset-0 bg-indigo-500/15" />
      </span>

      {/*
        The front card, holding a real frame.

        🔴 Owner, 2026-09-08: "the progress animation glass card is too empty."
        It was — an empty tinted rectangle with a play button floating on it,
        which read as a placeholder rather than as somebody's video being
        worked on. The same still the welcome scene uses fills it, so this costs
        NO extra fetch: one url, already in cache by the time anyone reaches
        this screen.

        A dark scrim sits over it so the white play button keeps its contrast
        against whatever the photograph happens to be doing underneath.
      */}
      <span className="frenz-ai-breathe absolute left-[38%] top-[26%] flex h-24 w-32 items-center justify-center overflow-hidden rounded-2xl shadow-[0_16px_40px_-18px_rgb(79_70_229/0.8)] ring-1 ring-inset ring-white/40">
        <FrenzAIStill sizes="128px" />
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-indigo-900/35 via-indigo-800/20 to-violet-900/35"
        />
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-[0_6px_18px_-4px_rgb(30_27_75/0.55)]">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-indigo-600">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>

      {/* ── the badges ───────────────────────────────────────────────────── */}
      <span className="absolute right-[16%] top-[16%] flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-[13px] font-bold text-white shadow-[0_10px_24px_-8px_rgb(217_70_239/0.9)]">
        AI
      </span>
      <span className="absolute bottom-[16%] right-[20%] flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_12px_28px_-8px_rgb(37_99_235/0.9)]">
        <Wand2 className="h-5 w-5" />
      </span>

      {/* ── the drifting spheres ─────────────────────────────────────────── */}
      <span className="absolute left-[8%] top-[42%] h-4 w-4 rounded-full bg-gradient-to-br from-indigo-300 to-violet-500 shadow-[0_4px_10px_-2px_rgb(79_70_229/0.7)]" />
      <span className="absolute bottom-[12%] left-[22%] h-3 w-3 rounded-full bg-gradient-to-br from-sky-300 to-blue-500 shadow-[0_4px_10px_-2px_rgb(37_99_235/0.7)]" />
      <span className="absolute right-[10%] top-[46%] h-2 w-2 rounded-full bg-white" />
      <span className="absolute left-[46%] top-[10%] text-white/80 [animation-delay:1.2s]">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}
