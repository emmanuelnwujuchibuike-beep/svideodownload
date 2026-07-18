import { ArrowRight, Check, Gem, Sparkles } from "lucide-react";
import Link from "next/link";

/**
 * "Built for Creators. Loved by Everyone." — matches `public/main landing page.jpg`.
 *
 * Two halves: a benefit checklist on the left under the gradient headline, and the
 * rewards card on the right with the gem sitting on a lit pedestal.
 *
 * ── The artwork ───────────────────────────────────────────────────────────────
 *
 * The mockup places a large rendered illustration (a figure in headphones against a
 * neon city, composited with device frames) on the left. That is a licensed/AI
 * raster asset I do not have, and inventing a substitute would be guessing at the
 * brand. Rather than ship a broken <img> or a stock placeholder, the left column is
 * built as the gradient-and-glow composition the rest of the page already uses, so
 * the section reads as finished. **Drop the real asset in and swap `ArtPanel` for an
 * <Image> when it exists** — the layout reserves exactly its aspect ratio, so
 * nothing shifts (CLS stays flat).
 *
 * Same rules as the hero: no images, compositor-only motion, no `will-change`.
 */

const BENEFITS = [
  "Lightning fast downloads",
  "Cross-device sync",
  "High quality, always",
  "Smart offline mode",
  "Ad-free premium experience",
  "Daily rewards & bonuses",
];

/** Placeholder for the mockup's hero illustration. See the note above. */
function ArtPanel() {
  return (
    <div
      aria-hidden
      className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-white/10 bg-[#070b1c]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_15%,rgba(139,92,246,0.4)_0%,rgba(30,27,75,0.5)_45%,transparent_75%)]" />
      {/* Neon horizon — the city glow in the mockup, as pure gradient. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,rgba(56,189,248,0.35)_0%,rgba(168,85,247,0.18)_40%,transparent_100%)]" />
      {/* Floating device plates, echoing the composited screens. */}
      <span className="frenz-float absolute left-[12%] top-[22%] h-24 w-16 rounded-xl border border-white/15 bg-gradient-to-br from-fuchsia-500/30 to-indigo-600/30 backdrop-blur-sm" />
      <span
        className="frenz-float absolute right-[16%] top-[32%] h-28 w-20 rounded-xl border border-white/15 bg-gradient-to-br from-blue-500/30 to-violet-600/30 backdrop-blur-sm"
        style={{ animationDelay: "-2s" }}
      />
      <span
        className="frenz-float absolute bottom-[18%] left-[30%] h-20 w-28 rounded-xl border border-white/15 bg-gradient-to-br from-sky-500/25 to-purple-600/25 backdrop-blur-sm"
        style={{ animationDelay: "-4s" }}
      />
    </div>
  );
}

export function CreatorsSection() {
  return (
    <section className="dark relative overflow-hidden bg-[#050816] py-16 text-white sm:py-20">
      <div className="container max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <ArtPanel />

          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-200">
              <Sparkles className="h-3 w-3" /> Premium Experience
            </span>

            <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl">
              Built for Creators.
              <br />
              Loved by{" "}
              <span className="bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent">
                Everyone.
              </span>
            </h2>

            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-center gap-2.5 text-sm text-white/85">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>

            {/* Rewards card */}
            <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-950/80 to-violet-950/80 p-6 backdrop-blur">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold">Get Frenz &amp; Earn Rewards</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/65">
                    Complete simple tasks, invite friends, and earn points. Redeem exciting
                    rewards and premium perks.
                  </p>
                  <Link
                    href="/login?signup=1"
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:opacity-95 active:scale-[0.99]"
                  >
                    Get Frenz Now <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                {/* Gem on a lit pedestal. */}
                <div aria-hidden className="relative mx-auto h-28 w-28 shrink-0">
                  <span className="absolute inset-x-2 bottom-2 h-6 rounded-[50%] bg-violet-500/40 blur-lg" />
                  <span className="absolute inset-x-4 bottom-3 h-4 rounded-[50%] border border-violet-400/40 bg-violet-600/30" />
                  <span className="frenz-float absolute inset-x-0 top-1 flex h-20 items-center justify-center">
                    <Gem className="h-14 w-14 text-violet-300 drop-shadow-[0_0_18px_rgba(167,139,250,0.7)]" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
