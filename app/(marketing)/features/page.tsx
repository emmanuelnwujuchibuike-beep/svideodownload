import { ArrowLeft, Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getProfiles, isRealStage } from "@/lib/content/genome/queries";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";

/**
 * "Everything Frenz is built for" — the full capability list.
 *
 * Rendered entirely from the Product Genome, so this page cannot drift from what
 * the product actually does. Adding a capability to the genome adds it here, to the
 * product card, to the JSON-LD and to the Experience Graph at once; there is no
 * hand-maintained feature list to forget.
 *
 * Shipped capabilities and planned ones are visually separated rather than mixed:
 * a reader scanning this page is deciding whether to sign up, and a list that
 * blends "you can do this today" with "we intend to build this" answers the wrong
 * question. Every entry's stage comes from `veracity`, so the split is structural
 * and cannot be fudged by copy.
 */
export const metadata: Metadata = {
  title: "Features — everything Frenz is built for",
  description:
    "The full list of what Frenz does today: downloading, community, messaging, creation and more.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  // Admin is real but internal — never a marketing surface.
  const profiles = getProfiles().filter(({ platform }) => platform.id !== "admin");

  const shippedCount = profiles.reduce(
    (n, { genome }) => n + genome.capabilities.filter((c) => isRealStage(c.stage)).length,
    0,
  );

  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      <main className="container max-w-5xl py-28 sm:py-32">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        <header className="mt-6">
          <span className="inline-flex items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
            Everything Frenz is built for
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">
            {shippedCount} features, across {profiles.filter((p) => p.platform.veracity.claimable).length} products.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Save from {SHOWCASE_PLATFORMS.length} platforms, watch and post, message your people, and
            keep it all without filling your phone. Here is the whole list — what works today, and
            what is still coming.
          </p>
        </header>

        <div className="mt-12 space-y-12">
          {profiles.map(({ platform, genome }) => {
            const Icon = platform.icon;
            const shipped = genome.capabilities.filter((c) => isRealStage(c.stage));
            const planned = genome.capabilities.filter((c) => !isRealStage(c.stage));
            const features = [...genome.features.core, ...genome.features.optional].filter((f) =>
              isRealStage(f.stage),
            );

            return (
              <section key={platform.id}>
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accent} text-white shadow-md`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                      {platform.name}
                      {!platform.veracity.claimable ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Coming soon
                        </span>
                      ) : null}
                    </h2>
                    <p className="text-sm text-muted-foreground">{genome.purpose}</p>
                  </div>
                </div>

                {shipped.length > 0 ? (
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {shipped.map((cap) => (
                      <li
                        key={cap.id}
                        className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft"
                      >
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                          {cap.name}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {cap.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {features.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {features.map((f) => (
                      <li
                        key={f.id}
                        className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {f.name}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {planned.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-border p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> Planned
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {planned.map((cap) => (
                        <li key={cap.id} className="text-xs text-muted-foreground">
                          {cap.name}
                          <span className="mx-1.5 text-border">·</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {shipped.length === 0 && planned.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Not built yet — nothing to list. This entry is here so the roadmap is visible,
                    not to imply the product exists.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>

        <div className="mt-16 rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
          <h2 className="text-xl font-bold tracking-tight">Start with a link</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            No account needed to download. Paste a link and go.
          </p>
          <Link
            href="/#download"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:opacity-95 active:scale-[0.99]"
          >
            Download Now
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
