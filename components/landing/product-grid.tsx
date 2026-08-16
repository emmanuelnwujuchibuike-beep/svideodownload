import { ArrowRight, Image as ImageIcon, LayoutGrid } from "lucide-react";
import Link from "next/link";

import { getClaimableProfiles } from "@/lib/content/genome/queries";

/**
 * The ecosystem product grid — rendered entirely from the Product Genome.
 *
 * Replaces a hand-written four-card list whose entries sat at mixed granularity
 * ("Trending" and "Chat" are capabilities of Community, not products). Everything
 * here now derives from `lib/content/genome`, so a product's card, its copy and its
 * structured data cannot drift from one another — they are one record.
 *
 * ── Why every product renders, but not every product links ──────────────────────
 *
 * The landing mockup shows six product cards, each with a live "Explore" link.
 * Three of those products do not exist: there is no `/studio`, no `/cloud`, and the
 * Smart suite's only UI surface is commented out of `app/layout.tsx`. Linking them
 * would ship three 404s from the front door and claim three products we don't have.
 *
 * A homepage full of mockup cards for products that don't exist is exactly the
 * "doesn't exist / low value" content that gets a site flagged — so this grid now
 * shows ONLY claimable products (`getClaimableProfiles()`, not `getProfiles()`):
 * Studio, Cloud and the Smart suite never appear here at all, not even as an inert
 * "Coming soon" card. The full roadmap still lives on `/features`, where planned
 * work is clearly labelled as planned — the front door only shows what's real.
 * Enforced by `lib/content/reality-ledger.test.ts` and the genome audit.
 *
 * Server component — zero client JS on a page under a 2-second budget.
 */
export function ProductGrid() {
  // Admin is real but internal — never a marketing card. (getClaimableProfiles
  // already excludes every unbuilt product; admin still needs its own filter
  // since it IS claimable, just not something to advertise.)
  const profiles = getClaimableProfiles().filter(({ platform }) => platform.id !== "admin");

  return (
    <section id="products" className="frenz-reveal container max-w-6xl scroll-mt-24 px-2 py-10 sm:py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-300">
          All-in-One Platform
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
          One Platform. Unlimited Possibilities.
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          Frenz brings together powerful tools and social experiences in one seamless platform.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map(({ platform, genome }) => {
          const Icon = platform.icon;

          return (
            <Link
              key={platform.id}
              href={platform.veracity.provingRoute ?? platform.basePath}
              className="group rounded-2xl border border-border/70 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card active:scale-[0.98]"
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accent} text-white shadow-md transition-transform duration-300 group-hover:scale-110`}>
                <Icon className="h-5 w-5" />
              </span>

              <h3 className="mt-4 text-lg font-bold tracking-tight">{platform.name}</h3>

              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{genome.purpose}</p>

              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                Explore
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>

      {/* "See All Features" — the mockup's closing action for this section.
          Opens /features — the full capability list, rendered from the Product
          Genome so it cannot drift from what the product actually does. */}
      <div className="mt-8 flex justify-center">
        <Link
          href="/features"
          className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-6 py-3 text-sm font-semibold shadow-soft transition hover:border-foreground/20 hover:shadow-card active:scale-[0.99]"
        >
          See All Features <LayoutGrid className="h-4 w-4" />
        </Link>
      </div>

      {/* Explore wallpapers (owner) — a premium gradient CTA below the feature
          grid, opening the standalone full-screen gallery. `prefetch` warms the
          route so the transition is instant rather than a spinner, and the page
          is public: a signed-out visitor gets the whole library and can download
          from it. */}
      <div className="mt-3 flex justify-center">
        <Link
          href="/wallpapers"
          prefetch
          className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 active:scale-[0.98]"
        >
          <span aria-hidden className="pointer-events-none absolute -inset-1 -z-10 rounded-3xl bg-gradient-to-r from-blue-500 to-fuchsia-500 opacity-40 blur-md" />
          <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full" />
          <ImageIcon className="relative h-4 w-4" />
          <span className="relative">Explore wallpapers</span>
          <ArrowRight className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}
