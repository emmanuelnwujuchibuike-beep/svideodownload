import { ArrowUpRight, Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

/**
 * The site-wide 404 (2026-08-16 SEO audit finding: none existed — Next was
 * serving its own unbranded default for every bad URL).
 *
 * ── Why this matters beyond looking nicer ─────────────────────────────────────
 * A dead-end 404 with no internal links loses whatever crawl budget/authority
 * led a visitor or a bot here in the first place. This one is a real page —
 * on-brand chrome, an actual 404 status (Next.js sets this automatically for
 * `not-found.tsx`), and links back into the site's real content (top
 * downloaders, wallpapers, help) rather than a blank stop.
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  const featured = getPrimaryPages().slice(0, 6);

  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      <main className="container flex min-h-[70vh] max-w-3xl flex-col items-center justify-center pb-20 pt-[calc(var(--frenz-safe-top)+7rem)] text-center">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="h-7 w-7" />
        </span>
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-3 max-w-sm text-muted-foreground">
          That link may be broken or the page may have moved. Here&rsquo;s where you
          can go instead.
        </p>
        <Link
          href="/"
          className="mt-7 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
        >
          Go to homepage
        </Link>

        <div className="mt-14 w-full text-left">
          <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Popular downloaders
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((d) => {
              const platform = PLATFORMS[d.platformId];
              const Icon = BRAND_ICONS[d.platformId];
              return (
                <Link
                  key={d.slug}
                  href={`/${d.slug}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft transition hover:border-foreground/20 hover:shadow-card"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${platform.accent} text-white`}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {d.brand} {d.thing}
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
                </Link>
              );
            })}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Looking for wallpapers?{" "}
            <Link href="/wallpapers" className="font-medium text-primary hover:underline">
              Browse the gallery
            </Link>{" "}
            or visit the{" "}
            <Link href="/help" className="font-medium text-primary hover:underline">
              Help Center
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
