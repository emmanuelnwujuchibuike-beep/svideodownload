import { ArrowRight, Crown } from "lucide-react";
import Link from "next/link";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AI CLEAN CARD — the one the owner drew
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from `public/frenz ai page.jpg` (owner, 2026-09-08: "build everything
 * exactly in details as it in the image, dont skip or simplify any thing").
 * The annotation beside it in that image asks for four specific things —
 * "subtle motion, glowing accents, more visual depth, feels alive, not static"
 * — and each one is a section below.
 *
 * ── 🔴 DRAWN, NOT PHOTOGRAPHED ───────────────────────────────────────────────
 *
 * Every glow, chip, beam and circuit trace here is CSS and inline SVG. The
 * reference is a render that would be a ~300 kB JPEG, and the same owner has a
 * standing rule that "every must be light weight" — a hero image on the first
 * card of the page is exactly where that rule earns its keep. This whole scene
 * is under a kilobyte of markup and makes zero network requests.
 *
 * ── 🔴 THE MOTION OBEYS THE BATTERY RULE ─────────────────────────────────────
 *
 * "Feels alive, not static" is easy to over-serve. Everything that moves here
 * moves on `transform`/`opacity` only, on long cycles, and stops dead under
 * `prefers-reduced-motion` — the same contract as the rest of the Frenz AI
 * environment (lib/ai/presence.ts). A card that pins a phone's compositor to
 * look premium is not premium.
 *
 * ── A SERVER COMPONENT, AND IT MUST STAY ONE ─────────────────────────────────
 *
 * There is not a hook in this file. Marking a card in this feature
 * `"use client"` is what broke the hub with "something went wrong" on
 * 2026-09-08 — see the note in frenz-ai-tool-card.tsx. It renders `FrenzAICore`,
 * which IS a client component, and that is fine: the boundary forbids passing a
 * function as a prop, not rendering a client child.
 */
export function FrenzAICleanShowcase({
  href = "/studio/ai/clean",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "group relative overflow-hidden rounded-[1.75rem]",
        // The card is dark in BOTH themes, exactly as drawn. A card that only
        // reads correctly in one theme is a card that is broken in the other.
        "bg-[#0a1030] text-white",
        // Depth from light rather than from a heavy border: a lit hairline
        // edge, an inner top highlight, and a wide coloured drop beneath.
        "ring-1 ring-inset ring-white/12",
        "shadow-[0_24px_60px_-24px_rgb(37_99_235/0.55),inset_0_1px_0_rgb(255_255_255/0.10)]",
        className,
      )}
    >
      {/* ── the ground: two drifting colour fields ─────────────────────────── */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(120% 90% at 12% 8%, rgba(37,99,235,0.42) 0%, transparent 58%)," +
            "radial-gradient(95% 85% at 92% 82%, rgba(147,51,234,0.38) 0%, transparent 62%)," +
            "linear-gradient(160deg, #0b1236 0%, #070a24 55%, #0a0d2c 100%)",
        }}
      />

      {/* ── the circuitry, drawn ───────────────────────────────────────────── */}
      {/*
        🔴 MASKED AWAY FROM THE COPY. Caught in a screenshot, not in review: the
        traces ran straight THROUGH "Remove unwanted captions…", which looked
        like a rendering fault rather than a backdrop. The mask fades them out
        across the lower-left, where the title, the description and the button
        live, so the circuitry stays what it is — depth behind the content.
      */}
      <svg
        aria-hidden
        viewBox="0 0 400 260"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.42]"
        style={{
          maskImage: "linear-gradient(200deg, #000 0%, #000 32%, transparent 62%)",
          WebkitMaskImage: "linear-gradient(200deg, #000 0%, #000 32%, transparent 62%)",
        }}
      >
        <defs>
          {/*
            🔴 `userSpaceOnUse`, NOT the default objectBoundingBox.

            A gradient on a straight horizontal line has a ZERO-HEIGHT bounding
            box, and a zero-area box makes the browser render nothing at all —
            the stroke simply disappears. It is invisible in code review and
            only a screenshot catches it; this codebase lost time to exactly
            that once already.
          */}
          <linearGradient id="fac-trace" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="400" y2="0">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <g stroke="url(#fac-trace)" strokeWidth="1" fill="none">
          <path d="M0 44 H112 L132 24 H236" />
          <path d="M0 96 H86 L104 78 H190" />
          <path d="M0 150 H70 L92 172 H210" />
          <path d="M0 214 H140 L162 192 H262" />
        </g>
        <g fill="#7dd3fc">
          <circle cx="236" cy="24" r="2.5" />
          <circle cx="190" cy="78" r="2.5" />
          <circle cx="210" cy="172" r="2.5" />
          <circle cx="262" cy="192" r="2.5" />
        </g>
      </svg>

      {/*
        ── the floating scene, right side ───────────────────────────────────

        🔴 VISIBLE ON MOBILE. It was `hidden sm:block` and a screenshot caught
        it: the owner's reference IS a phone, and the chips are the single most
        recognisable thing in it. Hiding the illustration on the exact viewport
        the design was drawn for is not a responsive decision, it is losing the
        design. It scales down here instead.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-[52%] origin-top-right scale-[0.78] sm:w-1/2 sm:scale-100"
      >
        {/* the tilted panel the chips sit over */}
        <span className="absolute right-8 top-[26%] h-28 w-36 rotate-[14deg] rounded-2xl bg-white/[0.07] ring-1 ring-inset ring-white/15 backdrop-blur-[2px]" />

        {/*
          The beam. A long, slow sweep rather than a shimmer — motion that reads
          as light moving through the scene, not as a loading state.
        */}
        <span className="frenz-ai-beam absolute right-10 top-[18%] h-40 w-[3px] rotate-[38deg] rounded-full bg-gradient-to-b from-transparent via-white to-transparent opacity-80 shadow-[0_0_18px_4px_rgb(255_255_255/0.35)]" />

        {/* the three chips — the text this tool removes */}
        <span className="frenz-ai-drift-a absolute right-[4.5rem] top-[22%] -rotate-[8deg] rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_-6px_rgb(217_70_239/0.7)]">
          Subtitles
        </span>
        <span className="frenz-ai-drift-b absolute right-[7.5rem] top-[45%] -rotate-[6deg] rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_8px_20px_-6px_rgb(37_99_235/0.7)]">
          Captions
        </span>
        <span className="frenz-ai-drift-c absolute right-6 top-[58%] rotate-[6deg] rounded-lg bg-slate-700/80 px-2.5 py-1 text-[11px] font-semibold text-slate-200 ring-1 ring-inset ring-white/10">
          Text
        </span>

        {/* the play button */}
        <span className="absolute right-[5.5rem] top-[38%] flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-[0_6px_18px_-4px_rgb(0_0_0/0.5)]">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-slate-900">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {/* sparkles */}
        <span className="frenz-ai-twinkle absolute right-4 top-[30%] h-1.5 w-1.5 rounded-full bg-white" />
        <span className="frenz-ai-twinkle absolute right-[11rem] top-[68%] h-1 w-1 rounded-full bg-sky-200 [animation-delay:1.4s]" />
      </div>

      {/* ── the content ────────────────────────────────────────────────────── */}
      <div className="relative p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          {/* the Core, in its lit ring */}
          {/*
            🔴 `md`, not `sm`, and on a lit disc. At `sm` inside a 56px ring the
            aperture was a dark speck — a screenshot showed the badge reading as
            an empty circle, which is the opposite of the reference, where it is
            the brightest thing on the card after the button. Presence stays `calm`:
            the battery rule says energetic levels exist only while real work is
            happening, and an idle hub is not that.
          */}
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-sky-400/15 ring-1 ring-inset ring-sky-300/50 shadow-[0_0_30px_-2px_rgb(56_189_248/0.85)]">
            <FrenzAICore presence="calm" size="md" />
          </span>

          {/*
            The PRO badge, gold as drawn — deliberately NOT the site's primary
            blue. It marks a tier, and a tier marker that shares the brand
            colour stops reading as a marker at all.
          */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-950 shadow-[0_6px_18px_-6px_rgb(245_158_11/0.9)]">
            <Crown className="h-3.5 w-3.5" aria-hidden />
            Pro
          </span>
        </div>

        <h2 className="mt-14 text-[1.6rem] font-bold leading-tight tracking-[-0.02em] sm:mt-16 sm:text-[1.75rem]">
          AI Clean
        </h2>
        <p className="mt-1.5 max-w-[56%] text-sm leading-relaxed text-slate-300 sm:max-w-[19rem]">
          Remove unwanted captions, subtitles and text from your videos.
        </p>

        {/*
          The CTA fills the card's width, as drawn. It is a real `<Link>` — the
          whole card is deliberately NOT one giant anchor, because a card that
          contains a button and is also itself a button gives a screen reader
          two overlapping targets for one action.
        */}
        <Link
          href={href}
          prefetch
          className={cn(
            "mt-5 flex w-full items-center justify-center gap-2 rounded-full",
            "bg-gradient-to-r from-blue-500 via-indigo-500 to-fuchsia-500",
            "px-5 py-3.5 text-[0.95rem] font-semibold text-white",
            "shadow-[0_12px_30px_-10px_rgb(99_102_241/0.9)]",
            "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1030]",
          )}
        >
          Open AI Clean
          <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
