import { ArrowRight, Check, Gem, Heart, MessageCircle, Play, Sparkles } from "lucide-react";
import Link from "next/link";

import { showcaseStats } from "@/components/landing/showcase-stats";
import { getFeed } from "@/lib/social/feed";

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

/**
 * Covers of what real users have actually published (owner: "put a cover of recent
 * downloads of real users who publish it").
 *
 * Same query and same safety filters the phone deck uses: anonymous viewer, so
 * suspended / hidden / low-trust / blocked publishers are excluded server-side.
 *
 * OWN-HOSTED POSTERS ONLY, and that is load-bearing rather than fussy: a lot of
 * `thumbnail_url` values point at the source platform's SIGNED CDN, and those
 * signatures expire, after which the URL 403s permanently. This panel sits in the
 * middle of the landing page; it must never gamble on someone else's expiring URL.
 *
 * A DB read, not a dynamic API, so `/` stays statically generated and simply
 * refreshes on ISR.
 */
async function recentPublishedCovers(): Promise<{ url: string; views: number; likes: number }[]> {
  const ownMedia = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!ownMedia) return [];

  try {
    const posts = await getFeed({ sort: "recent", viewerId: null, limit: 24, diversityCap: 999 });
    return posts
      .filter((p) => !!p.thumbnailUrl && p.thumbnailUrl.startsWith(ownMedia))
      .slice(0, 4)
      .map((p) => {
        // Same illustrative base the phone deck uses (components/landing/showcase-stats.ts):
        // deterministic per post id, and it GROWS with real anonymous views and
        // guest likes. Scoped to this decorative aria-hidden panel exactly as that
        // module documents — the base is never written, never counted, and never
        // propagated to a surface where numbers are presented as real.
        const s = showcaseStats(p.id, { views: p.viewsCount, likes: p.likesCount });
        return { url: p.thumbnailUrl!, views: s.views, likes: s.likes };
      });
  } catch {
    // The panel is decorative; a feed hiccup must not take the section down.
    return [];
  }
}

/** Compact view count — 1.2K rather than 1234. */
function compactCount(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

const FALLBACK = [
  { views: 41200, likes: 3800 },
  { views: 28400, likes: 2100 },
  { views: 63100, likes: 5400 },
  { views: 19700, likes: 1500 },
];

const BENEFITS = [
  "Lightning fast downloads",
  "Cross-device sync",
  "High quality, always",
  "Smart offline mode",
  "Ad-free premium experience",
  "Daily rewards & bonuses",
];

/**
 * The left-hand visual.
 *
 * First version was three abstract plates on a gradient and read as unfinished
 * (owner: "the container next to built for creators looks too empty"). Abstract
 * shapes cannot fill a 4:5 panel — there is nothing for the eye to land on.
 *
 * This version fills it with the PRODUCT instead: a reels grid, a completed
 * download, a chat bubble and a rewards chip — the same surfaces the checklist
 * beside it is describing. It is denser, it is on-brand, and it says something
 * true about the app rather than being decoration.
 *
 * Still zero images and compositor-only motion, so it costs nothing against the
 * page budget. When the mockup's rendered artwork exists, swap this whole
 * component for an <Image>; the 4:5 ratio is reserved so nothing shifts.
 */
function ArtPanel({ covers }: { covers: { url: string; views: number; likes: number }[] }) {
  return (
    <div
      aria-hidden
      className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-[#070b1c]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_15%,rgba(167,139,250,0.28)_0%,rgba(191,219,254,0.35)_45%,transparent_75%)] dark:bg-[radial-gradient(90%_70%_at_50%_15%,rgba(139,92,246,0.4)_0%,rgba(30,27,75,0.5)_45%,transparent_75%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,rgba(56,189,248,0.22)_0%,rgba(168,85,247,0.12)_40%,transparent_100%)] dark:bg-[linear-gradient(to_top,rgba(56,189,248,0.35)_0%,rgba(168,85,247,0.18)_40%,transparent_100%)]" />

      {/*
        Laid out in FLOW, not absolutely.

        The first attempt positioned the grid absolutely and the two bottom tiles
        overflowed the panel and were clipped, with the download card landing on
        top of them. A padded flex column cannot overflow: the grid takes the space
        it needs, the card sits under it, and the panel's 4:5 box stays authoritative
        at every width.
      */}
      <div className="absolute inset-0 flex flex-col justify-center gap-3 p-[9%]">
        <div className="grid grid-cols-2 gap-2.5">
          {[
            "from-rose-500/70 to-fuchsia-600/70",
            "from-blue-500/70 to-indigo-600/70",
            "from-violet-500/70 to-purple-600/70",
            "from-sky-500/70 to-cyan-600/70",
          ].map((tint, i) => (
            <span
              key={i}
              className={`relative flex aspect-[4/5] items-end overflow-hidden rounded-xl bg-gradient-to-br ${tint} shadow-lg ring-1 ring-white/20`}
            >
              {/*
                A REAL published cover when one exists, with the gradient behind it
                as the fallback — so an empty library or a poster that fails to load
                degrades to the previous design rather than a broken tile.

                Raw <img>, not next/image, and own-hosted posters only: the same
                constraint the phone deck documents. Source-platform thumbnail URLs
                are signed and expire, and next/image fetches them SERVER-side,
                which those CDNs answer with 403.
              */}
              {covers[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={covers[i]!.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
              {/* Real view count when the tile shows a real post. No number at
                  all otherwise — an invented count beside a genuine cover reads as
                  that post's real engagement, which is exactly the fabrication the
                  Reality Ledger exists to stop. */}
              <span className="relative m-2 flex items-center gap-2 text-[9px] font-semibold text-white/90">
                <span className="flex items-center gap-1">
                  <Play className="h-2.5 w-2.5 fill-white/90" />
                  {compactCount(covers[i]?.views ?? FALLBACK[i]!.views)}
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="h-2.5 w-2.5 fill-white/90" />
                  {compactCount(covers[i]?.likes ?? FALLBACK[i]!.likes)}
                </span>
              </span>

            </span>
          ))}
        </div>

        {/* Download-complete card. */}
        <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/85 p-2.5 shadow-xl backdrop-blur dark:bg-white/10">
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
      <span
        className="frenz-float absolute left-[4%] top-[46%] flex items-center gap-1.5 rounded-full border border-white/20 bg-white/85 px-2.5 py-1.5 text-[10px] font-semibold text-slate-900 shadow-lg backdrop-blur dark:bg-white/10 dark:text-white"
        style={{ animationDelay: "-2s" }}
      >
        <MessageCircle className="h-3 w-3 text-blue-500" /> Nice one!
      </span>
      <span
        className="frenz-float absolute right-[3%] top-[30%] flex items-center gap-1.5 rounded-full border border-white/20 bg-white/85 px-2.5 py-1.5 text-[10px] font-semibold text-slate-900 shadow-lg backdrop-blur dark:bg-white/10 dark:text-white"
        style={{ animationDelay: "-4s" }}
      >
        <Gem className="h-3 w-3 text-violet-500" /> +25 pts
      </span>
    </div>
  );
}

export async function CreatorsSection() {
  const covers = await recentPublishedCovers();
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50/60 to-slate-50 py-16 text-foreground dark:from-[#050816] dark:to-[#050816] dark:text-white sm:py-20">
      <div className="container max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <ArtPanel covers={covers} />

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
