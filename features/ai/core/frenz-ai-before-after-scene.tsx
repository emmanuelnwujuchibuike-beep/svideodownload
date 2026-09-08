import { Volume2 } from "lucide-react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WELCOME SCENE — the promise, shown rather than described
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from `public/frenz ai welcome page.jpg`: two glass video cards side by
 * side, the left labelled "Original" with a caption burned across it, the right
 * labelled "Clean Result" with the caption gone, a lit mark between them, and
 * spheres drifting around the pair.
 *
 * ── 🔴 THE SCENE IS THE ARGUMENT ────────────────────────────────────────────
 *
 * Everything else on that page is words. This is the only part that says what
 * the tool actually does, and it says it in about a second: same frame, caption
 * present, caption absent. Cutting it down to one card or a static icon would
 * remove the entire reason the page exists.
 *
 * ── Drawn, and priced ───────────────────────────────────────────────────────
 *
 * No photographs. The "video" is a CSS gradient landscape — a sky wash, a ridge
 * line, water — which costs bytes rather than a network request, and the owner's
 * standing rule is that everything be lightweight. Two real images here would be
 * the heaviest thing on the first screen of the feature.
 *
 * ── The battery rule ────────────────────────────────────────────────────────
 *
 * Only the spheres and the centre mark move, on 9-16 second cycles, on
 * `transform`/`opacity`, all stopping under `prefers-reduced-motion` and on a
 * hidden tab via `--ai-play`. The cards themselves are still: a page somebody
 * lands on and reads should not be animating two video frames at them.
 *
 * A server component — no hooks.
 */
export function FrenzAIBeforeAfterScene({ className }: { className?: string }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-md px-2", className)}>
      {/* the light the whole scene sits in */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 45%, rgba(129,140,248,0.28) 0%, transparent 72%)," +
            "radial-gradient(45% 45% at 85% 78%, rgba(217,70,239,0.22) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex items-start justify-center gap-3 sm:gap-4">
        <VideoCard variant="original" />
        <VideoCard variant="clean" />

        {/*
          The mark between them, on the seam. It is the transformation — so it
          sits exactly where one card becomes the other, and it is the only lit
          thing in the middle of the composition.
        */}
        <span
          aria-hidden
          // 44%, not 50%: the two cards are offset vertically (the clean one
          // sits lower), so the seam BETWEEN them is above the container middle.
          // Centring on the container put the mark on the right card instead of
          // the join — caught in a screenshot.
          className="frenz-ai-breathe absolute left-1/2 top-[44%] z-[2] flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/75 ring-1 ring-inset ring-white/80 backdrop-blur-md dark:bg-white/15"
          style={{ boxShadow: "0 0 40px -6px rgba(99,102,241,0.75)" }}
        >
          <FrenzLogo size={26} alt="" />
        </span>
      </div>

      {/* the drifting spheres from the reference */}
      <span aria-hidden className="frenz-ai-drift-a absolute -left-1 top-[26%] h-6 w-6 rounded-full bg-gradient-to-br from-indigo-300 to-violet-600 shadow-[0_6px_16px_-4px_rgb(79_70_229/0.8)]" />
      <span aria-hidden className="frenz-ai-drift-b absolute -right-1 top-[22%] h-5 w-5 rounded-full bg-gradient-to-br from-sky-300 to-blue-600 shadow-[0_6px_16px_-4px_rgb(37_99_235/0.8)]" />
      <span aria-hidden className="frenz-ai-drift-c absolute right-[6%] top-[52%] h-7 w-7 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-600 shadow-[0_8px_20px_-6px_rgb(217_70_239/0.8)]" />
      <span aria-hidden className="frenz-ai-drift-a absolute bottom-[2%] left-[28%] h-5 w-5 rounded-full bg-gradient-to-br from-indigo-400 to-blue-700 shadow-[0_6px_16px_-4px_rgb(67_56_202/0.8)]" />

      {/* the small floating mark tiles */}
      <span aria-hidden className="frenz-ai-drift-b absolute -right-1 top-[2%] flex h-11 w-11 items-center justify-center rounded-2xl bg-white/60 ring-1 ring-inset ring-white/70 backdrop-blur dark:bg-white/10">
        <FrenzLogo size={20} alt="" />
      </span>
      <span aria-hidden className="frenz-ai-drift-c absolute -left-2 bottom-[16%] flex h-10 w-10 items-center justify-center rounded-2xl bg-white/55 ring-1 ring-inset ring-white/70 backdrop-blur dark:bg-white/10">
        <FrenzLogo size={18} alt="" />
      </span>
    </div>
  );
}

/**
 * One glass card. The two differ in exactly three ways — the chip, the caption,
 * and the tilt — which is the point: everything else being identical is what
 * makes the missing caption read as the result rather than as a different clip.
 */
function VideoCard({ variant }: { variant: "original" | "clean" }) {
  const clean = variant === "clean";

  return (
    <figure
      className={cn(
        "relative w-[46%] max-w-[11rem] overflow-hidden rounded-[1.25rem] p-2",
        "bg-white/55 ring-1 ring-inset ring-white/70 backdrop-blur-md",
        "shadow-[0_20px_50px_-24px_rgb(49_46_129/0.65)]",
        "dark:bg-white/10 dark:ring-white/20",
        clean ? "mt-6 rotate-[2deg]" : "-rotate-[2deg]",
      )}
    >
      <div className="relative overflow-hidden rounded-[0.9rem]">
        {/*
          The "video": a drawn landscape. Sky, a far ridge, a near ridge, water.
          Four gradients rather than a photograph — see the note above on why
          there are no images on this screen.
        */}
        <div className="relative aspect-[9/13] w-full">
          <span
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg,#bfdbfe 0%,#e0f2fe 38%,#f0f9ff 52%,#dbeafe 100%)",
            }}
          />
          {/* far ridge */}
          <span
            className="absolute inset-x-0 top-[26%] h-[26%]"
            style={{
              background: "linear-gradient(180deg,#94a3b8 0%,#64748b 100%)",
              clipPath: "polygon(0 62%, 18% 22%, 34% 54%, 52% 8%, 72% 46%, 88% 20%, 100% 52%, 100% 100%, 0 100%)",
            }}
          />
          {/* near ridge */}
          <span
            className="absolute inset-x-0 top-[38%] h-[22%]"
            style={{
              background: "linear-gradient(180deg,#475569 0%,#334155 100%)",
              clipPath: "polygon(0 70%, 22% 30%, 44% 66%, 66% 24%, 86% 58%, 100% 34%, 100% 100%, 0 100%)",
            }}
          />
          {/* water, and its reflection */}
          <span
            className="absolute inset-x-0 bottom-0 top-[58%]"
            style={{ background: "linear-gradient(180deg,#38bdf8 0%,#0ea5e9 45%,#0369a1 100%)" }}
          />
          <span
            className="absolute inset-x-0 top-[58%] h-[16%] opacity-40"
            style={{
              background: "linear-gradient(180deg,#334155 0%,transparent 100%)",
              clipPath: "polygon(0 0, 22% 55%, 44% 6%, 66% 52%, 86% 12%, 100% 44%, 100% 0)",
            }}
          />

          {/*
            🔴 THE CAPTION IS THE WHOLE DEMONSTRATION, so it is only on the
            left. Same frame, same crop, same colours — the single difference
            between the two cards is this box, which is precisely the difference
            the product makes.
          */}
          {!clean ? (
            <span className="absolute inset-x-1.5 bottom-9 rounded-md bg-black/65 px-1.5 py-1 text-[7.5px] font-medium leading-snug text-white">
              This is an amazing place to visit
            </span>
          ) : null}

          {/* the scrubber */}
          <span className="absolute inset-x-1.5 bottom-1.5">
            <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/40">
              <span className="block h-full w-[27%] rounded-full bg-rose-500" />
            </span>
            <span className="mt-1 flex items-center justify-between">
              <span className="text-[7px] font-semibold text-white/95">0:12 / 0:45</span>
              <Volume2 className="h-2.5 w-2.5 text-white/95" aria-hidden />
            </span>
          </span>
        </div>
      </div>

      {/* the label chip, floating over the top-left corner as drawn */}
      <figcaption
        className={cn(
          "absolute left-3.5 top-3.5 rounded-md px-2 py-1 text-[9px] font-bold",
          clean
            ? "bg-white/90 text-indigo-700 ring-1 ring-inset ring-indigo-200"
            : "bg-slate-900/80 text-white",
        )}
      >
        {clean ? "Clean Result" : "Original"}
      </figcaption>
    </figure>
  );
}
