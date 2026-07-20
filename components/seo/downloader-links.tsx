import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { AdSurface } from "@/features/monetization/ad-surface";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

/**
 * Internal-linking grid of the cluster primary pages — shown on the home page,
 * blog and footer to spread authority into each downloader cluster.
 */
export function DownloaderLinks({
  currentSlug,
  heading = "More free downloaders",
}: {
  currentSlug?: string;
  heading?: string;
}) {
  const items = getPrimaryPages().filter((d) => d.slug !== currentSlug);

  return (
    /*
      `id="platforms"` matches the landing page's platform showcase, so the
      "All platforms" button under the Download button resolves to the right
      section on BOTH surfaces without either knowing which page it is on.
    */
    <section id="platforms" className="scroll-mt-24 border-t border-border/60 py-16 sm:py-20">
      <div className="container max-w-5xl">
        {/*
          An ad above the platform grid, on the same shared surface as every
          other placement. This is the section the under-download button scrolls
          to, so the unit here is seen by a visitor who arrived deliberately
          rather than one scrolling past.
        */}
        <AdSurface zone="homepage_top" maxWidth="max-w-3xl" className="mb-10" />
        <h2 className="mb-8 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          {heading}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => {
            const platform = PLATFORMS[d.platformId];
            const Icon = BRAND_ICONS[d.platformId];
            return (
              <Link
                key={d.slug}
                href={`/${d.slug}`}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:border-foreground/20 hover:shadow-card"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${platform.accent} text-white`}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {d.brand} {d.thing}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {d.primaryKeyword}
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
              </Link>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Looking for something else?{" "}
          <Link href="/" className="font-medium text-primary hover:underline">
            Download from every supported platform on the home page
          </Link>{" "}
          or read our{" "}
          <Link href="/blog" className="font-medium text-primary hover:underline">
            downloading guides
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
