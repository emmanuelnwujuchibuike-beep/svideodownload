import { ArrowRight, LayoutGrid } from "lucide-react";
import Link from "next/link";

import { getProfiles } from "@/lib/content/genome/queries";

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
 * So the grid keeps the mockup's shape — all six, same layout — and lets veracity
 * decide the treatment: claimable products are links with "Explore"; unbuilt ones
 * are inert cards marked "Coming soon". The design intent survives; the claim does
 * not. This is enforced by `lib/content/reality-ledger.test.ts` and the genome
 * audit, so it cannot regress silently.
 *
 * Server component — zero client JS on a page under a 2-second budget.
 */
export function ProductGrid() {
  // Admin is real but internal — never a marketing card.
  const profiles = getProfiles().filter(({ platform }) => platform.id !== "admin");

  return (
    <section id="products" className="container max-w-6xl scroll-mt-24 py-10 sm:py-14">
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
          const live = platform.veracity.claimable;

          const card = (
            <>
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accent} text-white shadow-md transition-transform duration-300 ${live ? "group-hover:scale-110" : ""}`}
              >
                <Icon className="h-5 w-5" />
              </span>

              <div className="mt-4 flex items-center gap-2">
                <h3 className="text-lg font-bold tracking-tight">{platform.name}</h3>
                {!live ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coming soon
                  </span>
                ) : null}
              </div>

              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{genome.purpose}</p>

              {live ? (
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Explore
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              ) : null}
            </>
          );

          const shell =
            "rounded-2xl border border-border/70 bg-card p-6 shadow-soft transition-all duration-300";

          return live ? (
            <Link
              key={platform.id}
              href={platform.veracity.provingRoute ?? platform.basePath}
              className={`group ${shell} hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card`}
            >
              {card}
            </Link>
          ) : (
            // Not a link: there is nothing to open. Announced to assistive tech as
            // a plain group rather than a control that does nothing when activated.
            <div key={platform.id} className={`${shell} opacity-70`}>
              {card}
            </div>
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
    </section>
  );
}
