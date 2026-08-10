import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { WALLPAPERS_FAQ, WALLPAPERS_SECTIONS, wallpaperCategoryCounts } from "@/lib/seo/wallpapers";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * The readable half of /wallpapers.
 *
 * ── Why it is below the grid, not above it ────────────────────────────────────
 * Someone who lands here wants a picture, and four hundred words between them
 * and the gallery would be the classic recipe-blog mistake — the pattern Google
 * built the "helpful content" system to demote. The images stay first. This sits
 * underneath, where it is the answer to "what is this and how do I use it" for
 * anyone who scrolls, and the body copy for anyone crawling.
 *
 * ── A server component, deliberately ──────────────────────────────────────────
 * The gallery above is `"use client"` — necessary, it is an interactive filter
 * and a full-screen viewer. This is prose and links, so it ships as HTML with no
 * JavaScript attached to it at all. The FAQ uses a native `<details>` for the
 * same reason: the answers are in the document whether or not it is open, which
 * is what a crawler reads, and it needs no state, no library and no hydration.
 */
export function WallpaperSeoContent({ items }: { items: Wallpaper[] }) {
  const categories = wallpaperCategoryCounts(items);
  /*
    Real destinations, derived rather than typed. `getPrimaryPages()` returns
    the canonical page of each generated cluster, so this row cannot link to a
    slug that was never generated — the failure this project has hit before with
    hand-written internal links.
  */
  const downloaders = getPrimaryPages().slice(0, 6);

  return (
    <section
      aria-labelledby="wallpapers-about"
      className="mx-auto mt-10 w-full max-w-3xl px-4 pb-4"
    >
      <div className="border-t border-border/60 pt-8">
        <h2 id="wallpapers-about" className="text-xl font-bold tracking-tight">
          About the wallpaper gallery
        </h2>

        {/*
          The categories, as words.

          A crawler reading this page previously found a grid of photographs and
          almost no text — nothing to tell it the page is about nature, or
          minimalism, or space. These are the library's REAL categories with
          their real counts, derived from the same array the grid renders, so
          the page can never advertise a category that is empty.

          They are not links: category filtering is client state on this page,
          not a route, and a link to a URL nothing serves is the dead affordance
          this codebase keeps having to remove.
        */}
        {categories.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span
                key={c.name}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground"
              >
                {c.name}
                <span className="ml-1 text-muted-foreground/60">{c.count}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-6 space-y-7">
          {WALLPAPERS_SECTIONS.map((section) => (
            <div key={section.id}>
              <h3 className="text-base font-bold tracking-tight">{section.heading}</h3>
              <div className="mt-2 space-y-3">
                {section.paragraphs.map((text, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                    {text}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <h3 className="mt-9 text-base font-bold tracking-tight">Common questions</h3>
        <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {WALLPAPERS_FAQ.map((entry) => (
            <details key={entry.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                {entry.q}
                <ChevronDown
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{entry.a}</p>
            </details>
          ))}
        </div>

        {/* ── Outbound internal links ──────────────────────────────────────── */}
        <h3 className="mt-9 text-base font-bold tracking-tight">Also on Frenzsave</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Frenzsave saves video from the apps you already use — no watermark, no software to
          install.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {downloaders.map((page) => (
            <Link
              key={page.slug}
              href={`/${page.slug}`}
              className="rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-bold transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {page.brand}
            </Link>
          ))}
          <Link
            href="/help"
            className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Help Center <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
