import Link from "next/link";

import { BRAND_ICONS } from "@/lib/platform-icons";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";

/**
 * Short marketing labels, where the registry's own name isn't what a visitor
 * scanning a grid expects to read ("X (Twitter)" rather than "Twitter").
 *
 * An OVERRIDE map, not the tile list. The tiles themselves come straight from
 * `SHOWCASE_PLATFORMS` below — see the note in the component for why that
 * matters.
 */
const LABEL_OVERRIDES: Partial<Record<PlatformId, string>> = {
  twitter: "X (Twitter)",
};

export function PlatformShowcase() {
  return (
    <section id="platforms" className="frenz-reveal container max-w-6xl px-3 py-10 sm:py-14">
      <div className="text-center">
        {/*
          🔴 The count was derived; the TILES were not (owner, 2026-08-23:
          "correct this from 12 platform to the actual number of platform
          supported").

          The heading already read `SHOWCASE_PLATFORMS.length` — 12 — precisely
          so the claim could not drift from the product. But the grid beneath it
          was a hand-written list of NINE, so the page announced twelve and
          showed nine, and the half-derived arrangement hid it: whoever added
          telegram, linkedin and vimeo to the registry moved the heading without
          touching the grid.

          Both now come from the same array, so the number and the tiles are the
          same fact rendered twice and cannot disagree again.
        */}
        <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
          Save from {SHOWCASE_PLATFORMS.length} Platforms
        </h2>
        {/*
          🔴 "Plus any other public video link our universal extractor can
          handle." is GONE (owner, 2026-09-03: it "looks false and could flag
          adsense").

          They are right on both counts. "Any other public video link" is an
          absolute capability claim that cannot be true of any extractor, and
          "our universal extractor" oversells an unmapped-host fallback into a
          product. On a site already under review for thin/downloader content,
          an unverifiable capability claim is exactly the kind of sentence a
          reviewer reads as a promise the page cannot keep.

          What replaces it is a statement about BEHAVIOUR, not capability: we
          will tell you. That is true whatever the extractor manages, so it
          cannot drift out of date or be read as a guarantee.
        */}
        <p className="mt-2 text-sm text-muted-foreground">
          Not listed? Paste the link anyway and we&rsquo;ll tell you if we can save it.
        </p>
      </div>

      {/*
        `lg:grid-cols-6` — every platform now has a tile, so a 10-column track
        would leave two orphans on their own row. Six divides twelve exactly.
      */}
      <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {SHOWCASE_PLATFORMS.map((platform) => {
          const id = platform.id as PlatformId;
          const Icon = BRAND_ICONS[id];
          return (
            <Link
              key={id}
              href="/#download"
              className="group flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-4 shadow-soft transition hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${platform.accent} text-white shadow-sm transition-transform duration-300 group-hover:scale-110`}>
                {Icon ? <Icon className="h-5 w-5" /> : null}
              </span>
              <span className="text-center text-[11px] font-medium leading-tight">
                {LABEL_OVERRIDES[id] ?? platform.name}
              </span>
            </Link>
          );
        })}
        {/*
          The "More" tile is GONE (owner, 2026-08-23). With all twelve platforms
          on screen it pointed at nothing further — it linked back to the same
          paste box every other tile links to, so it implied a thirteenth
          destination that does not exist. The sentence under the heading
          already makes the honest version of that promise — see the note on
          it above, which replaced an absolute capability claim with one about
          what the page will do.
        */}
      </div>
    </section>
  );
}
