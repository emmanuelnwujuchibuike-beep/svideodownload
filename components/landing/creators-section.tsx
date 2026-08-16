import { ArrowRight, Check, Gem, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";

import { FeedGridGallery } from "@/components/landing/feed-grid-gallery";
import { getLandingSettings } from "@/lib/landing/settings";

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

/**
 * The left-hand visual — a 4:5 panel filled with the PRODUCT: the admin feed-grid
 * images (now an interactive, downloadable gallery), a completed-download card, a
 * chat bubble and a rewards chip — the same surfaces the checklist beside it
 * describes.
 *
 * The gallery is the one interactive part (a client island); everything else is
 * decorative (`aria-hidden`) gradient/glow, compositor-only motion, no
 * `will-change`, so the panel still costs little against the page budget.
 */
function ArtPanel({ images }: { images: string[] }) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-[#070b1c]">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_15%,rgba(167,139,250,0.28)_0%,rgba(191,219,254,0.35)_45%,transparent_75%)] dark:bg-[radial-gradient(90%_70%_at_50%_15%,rgba(139,92,246,0.4)_0%,rgba(30,27,75,0.5)_45%,transparent_75%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,rgba(56,189,248,0.22)_0%,rgba(168,85,247,0.12)_40%,transparent_100%)] dark:bg-[linear-gradient(to_top,rgba(56,189,248,0.35)_0%,rgba(168,85,247,0.18)_40%,transparent_100%)]" />

      {/*
        Laid out in FLOW, not absolutely.

        A padded flex column cannot overflow: the grid takes the space it needs, the
        card sits under it, and the panel's 4:5 box stays authoritative at every
        width. The grid itself is now the interactive FeedGridGallery — each admin
        image opens full screen with a Download button (owner, 2026-07-26).
      */}
      <div className="absolute inset-0 flex flex-col justify-center gap-3 p-[9%]">
        <FeedGridGallery images={images} />

        {/* Download-complete card. */}
        <div aria-hidden className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/85 p-2.5 shadow-xl backdrop-blur dark:bg-white/10">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-slate-900 dark:text-white">Saved to your library</span>
            <span className="block text-[10px] text-slate-500 dark:text-white/60">1080p · no watermark</span>
          </span>
        </div>
      </div>

      {/* Chat bubble + rewards chip, for depth at the edges. */}
      {/*
        🔴 `backdrop-blur` removed from both chips (owner, 2026-08-11: nothing on
        this page may cook a cheap phone).

        A backdrop filter is a GPU pass over whatever sits behind the element, and
        these two are also `frenz-float` — a 7s infinite translate. A blur behind a
        MOVING element cannot be cached: the backdrop changes every frame, so the
        pass is recomputed every frame, for both chips, for as long as the section
        is on screen. That combination is the most expensive shape a decoration can
        take, and it is on a page whose brief is to stay cool.

        It also bought nothing: the surface is `bg-white/85`, so only 15% of the
        backdrop ever showed through to be blurred. The chips look the same.
      */}
      <span
        aria-hidden
        className="frenz-float absolute left-[4%] top-[46%] flex items-center gap-1.5 rounded-full border border-white/20 bg-white/85 px-2.5 py-1.5 text-[10px] font-semibold text-slate-900 shadow-lg dark:bg-white/10 dark:text-white"
        style={{ animationDelay: "-2s" }}
      >
        <MessageCircle className="h-3 w-3 text-blue-500" /> Nice one!
      </span>
      <span
        aria-hidden
        className="frenz-float absolute right-[3%] top-[30%] flex items-center gap-1.5 rounded-full border border-white/20 bg-white/85 px-2.5 py-1.5 text-[10px] font-semibold text-slate-900 shadow-lg dark:bg-white/10 dark:text-white"
        style={{ animationDelay: "-4s" }}
      >
        <Gem className="h-3 w-3 text-violet-500" /> +25 pts
      </span>
    </div>
  );
}

export async function CreatorsSection() {
  // The 2×2 grid shows the admin-uploaded images (Admin → Landing page), not real
  // user posts (owner, 2026-07-26). Read at build/ISR through the service-role
  // client — no cookies — so `/` stays statically generated.
  const { feedGridImages } = await getLandingSettings();
  return (
    /*
      🔴 No background of its own — it inherits the landing's `--frenz-canvas`
      (owner, 2026-08-11: the native ground is "all over the landing page").

      This section painted `indigo-50/60 → slate-50` across 1298px, and the
      `slate-50` end is very nearly white and fully opaque. So a third of the way
      down the page the canvas quietly faded out into a white band and then
      resumed underneath — the one section on the page that broke the ground the
      rest of it now shares. Found by walking every full-width block's computed
      background rather than by eye; at 6% lightness difference it is easy to
      scroll straight past and still feel that something is off.
    */
    <section className="relative overflow-hidden py-16 text-foreground dark:text-white sm:py-20">
      <div className="container max-w-6xl px-2">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <ArtPanel images={feedGridImages} />

          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
              <Sparkles className="h-3 w-3" /> Premium Experience
            </span>

            <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl">
              Built for Creators.
              <br />
              Loved by{" "}
              <span className="bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text dark:from-blue-400 dark:to-fuchsia-400 text-transparent">
                Everyone.
              </span>
            </h2>

            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-white/85">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>

            {/* Rewards card */}
            <div className="mt-8 overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-indigo-100 to-violet-100 p-6 dark:border-white/10 dark:from-indigo-950/80 dark:to-violet-950/80 dark:backdrop-blur">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Get Frenz &amp; Earn Rewards</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-white/65">
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
                    <Gem className="h-14 w-14 text-violet-600 drop-shadow-[0_0_18px_rgba(167,139,250,0.55)] dark:text-violet-300 dark:drop-shadow-[0_0_18px_rgba(167,139,250,0.7)]" />
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
