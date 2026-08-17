import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudDownload,
  Link2,
  MonitorPlay,
  Music4,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getClaimableProfiles, isRealStage } from "@/lib/content/genome/queries";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

/**
 * "Everything Frenz is built for" — the full REAL capability list.
 *
 * Rendered entirely from the Product Genome, so this page cannot drift from what
 * the product actually does. Adding a capability to the genome adds it here, to the
 * product card, to the JSON-LD and to the Experience Graph at once; there is no
 * hand-maintained feature list to forget.
 *
 * Only claimable products appear (`getClaimableProfiles()`), and only their SHIPPED
 * capabilities are listed — no "Coming soon" products, no "Planned" capability
 * lists. This page used to show both, clearly labelled, on the theory that an
 * honestly-marked roadmap is fine to publish. It still is in principle, but a whole
 * page of "here's what we intend to build" reads as padding next to the actual
 * product, and that's exactly the kind of thin/aspirational content this pass is
 * removing site-wide. What Frenz does today is substantial enough to stand alone.
 */
export const metadata: Metadata = {
  title: "Features — everything Frenz is built for",
  description:
    "The full list of what Frenz does today: downloading, community, messaging, creation and more.",
  alternates: { canonical: "/features" },
};

/**
 * The pastel icon tiles on each capability row (the reference draws a different
 * one per row: a link, an HD badge, a download cloud, a shield).
 *
 * 🔴 Assigned BY POSITION, not by guessing at meaning from the capability's name.
 *
 * The genome has no icon field, and the alternative — keyword-matching "download"
 * or "quality" against `cap.name` — silently mislabels every capability whose
 * wording does not happen to contain the magic word, and does it worse each time
 * someone rewrites a name. A rotating palette is honest about what it is: rhythm
 * and colour separation down a long list, with no claim to describe the row. The
 * row's real meaning is its name and description, both already text.
 *
 * Every tile is `aria-hidden` for the same reason — an icon that does not encode
 * anything must not announce itself.
 *
 * Tints are the 50/100-step surfaces with 600-step glyphs, which is the pairing
 * that clears 4.5:1 on each of these hues; a 500-on-100 pairing does not.
 */
const ROW_TINTS = [
  { icon: Link2, bg: "bg-emerald-50 dark:bg-emerald-500/15", fg: "text-emerald-600 dark:text-emerald-300" },
  { icon: MonitorPlay, bg: "bg-violet-50 dark:bg-violet-500/15", fg: "text-violet-600 dark:text-violet-300" },
  { icon: CloudDownload, bg: "bg-blue-50 dark:bg-blue-500/15", fg: "text-blue-600 dark:text-blue-300" },
  { icon: ShieldCheck, bg: "bg-amber-50 dark:bg-amber-500/15", fg: "text-amber-600 dark:text-amber-300" },
  { icon: Music4, bg: "bg-rose-50 dark:bg-rose-500/15", fg: "text-rose-600 dark:text-rose-300" },
  { icon: Users, bg: "bg-indigo-50 dark:bg-indigo-500/15", fg: "text-indigo-600 dark:text-indigo-300" },
  { icon: Sparkles, bg: "bg-teal-50 dark:bg-teal-500/15", fg: "text-teal-600 dark:text-teal-300" },
] as const;

export default function FeaturesPage() {
  // Admin is real but internal — never a marketing surface. (getClaimableProfiles
  // already excludes every unbuilt product.)
  const profiles = getClaimableProfiles().filter(({ platform }) => platform.id !== "admin");

  const shippedCount = profiles.reduce(
    (n, { genome }) => n + genome.capabilities.filter((c) => isRealStage(c.stage)).length,
    0,
  );

  return (
    /* 🔴 REVERSED 2026-08-17 (owner: "the body, header, everything thats gray
       background to white ... and also the feature page"). The 2026-08-16
       entry directly below is the decision this replaces — that pass kept a
       neutral-gray ground deliberately, twice-confirmed same day. Noted here
       rather than deleted so the history of "we tried gray on purpose" isn't
       lost if a future gray request shows up again. No `topGradient` here
       either way — this page never had one. */
    <div className="bg-background text-foreground">
      <SiteHeader />
      {/* Native rhythm: content starts directly under the bar, as on iOS and as
          on the landing. `+7rem` left about a screen-third of empty canvas above
          the back button, which reads as a marketing page's letterhead — the
          reference starts the content roughly 50px below the header. Same ramp as
          the landing hero so the two pages open at the same height. */}
      <main className="container max-w-5xl pb-28 pt-[calc(var(--frenz-safe-top)+4.75rem)] sm:pb-32 sm:pt-[calc(var(--frenz-safe-top)+5.75rem)]">
        {/*
          🔴 A PILL, not a bare text link (owner, 2026-08-11 — the reference).

          "Back to home" was 13px muted text with a 16px glyph, floating on the
          page. Two things were wrong with it and only one was cosmetic: a native
          app's back affordance is a tappable OBJECT with an edge you can see, and
          a bare inline link here was ~20px tall — under the 24px WCAG 2.5.8
          minimum, on the one control whose whole job is to get you out of this
          page. The pill gives it a real surface and a real target.
        */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-white py-2 pl-2 pr-4 text-sm font-semibold text-slate-700 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.15)] ring-1 ring-inset ring-slate-900/[0.06] transition hover:text-slate-900 active:scale-[0.98] dark:bg-white/[0.06] dark:text-white/80 dark:ring-white/10 dark:hover:text-white"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10">
            <ArrowLeft className="h-4 w-4" />
          </span>
          Back to home
        </Link>

        <header className="mt-6">
          <span className="inline-flex items-center rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
            Everything Frenz is built for
          </span>
          {/*
            The NUMERALS carry the brand gradient (the reference). It is not
            decoration: the two figures are the only real claim this headline
            makes, and colouring them is what makes the sentence scan as data
            rather than as a slogan.

            Colour is not the only channel — they are the sentence's own words and
            read identically to a screen reader, so nothing depends on seeing the
            hue. Sized against iOS's Large Title rather than a web hero, matching
            the landing's ramp.
          */}
          <h1 className="mt-4 text-[clamp(1.75rem,7vw,2.5rem)] font-extrabold leading-[1.15] tracking-[-0.035em] text-slate-900 dark:text-white">
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-violet-400">
              {shippedCount}
            </span>{" "}
            features, across{" "}
            <span className="bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent dark:from-violet-400 dark:to-blue-400">
              {profiles.length}
            </span>{" "}
            products.
          </h1>
          <p className="mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-slate-600 dark:text-white/70">
            Save from {SHOWCASE_PLATFORMS.length} platforms, watch and post, message your people, and
            keep it all without filling your phone. Here is everything that works today.
          </p>
        </header>

        <div className="mt-12 space-y-12">
          {profiles.map(({ platform, genome }) => {
            const Icon = platform.icon;
            const shipped = genome.capabilities.filter((c) => isRealStage(c.stage));
            const features = [...genome.features.core, ...genome.features.optional].filter((f) =>
              isRealStage(f.stage),
            );

            return (
              <section key={platform.id}>
                {/*
                  The product header is a TINTED CARD (the reference), not a bare
                  row. It is the only violet surface in the group, which is what
                  makes it read as the heading for the white rows beneath it —
                  a native grouped list announces its section with a surface, not
                  with a font size.
                */}
                <div className="flex items-start gap-3.5 rounded-3xl bg-violet-500/[0.07] p-4 ring-1 ring-inset ring-violet-500/[0.12] dark:bg-violet-400/[0.08] dark:ring-violet-300/15">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accent} text-white shadow-lg shadow-violet-600/25`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-tight">{platform.name}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-white/70">
                      {genome.purpose}
                    </p>
                  </div>
                </div>

                {/*
                  ── The capability list, as native rows (owner, 2026-08-11) ────

                  It was a two-column grid of small cards. The reference is a
                  single column of full-width rows — icon tile, green check +
                  name, description, trailing chevron — which is the iOS/Flutter
                  grouped-list row, and it is the better shape here for a reason
                  beyond matching the image: a two-up grid of variable-length
                  descriptions gives every pair a ragged bottom edge and forces
                  the eye to re-find the left margin on each row.

                  🔴 The chevron is `aria-hidden` and these rows are NOT links.
                  There is no per-capability page to open, and marking up a
                  non-interactive row as a control — or giving it a `role` it
                  cannot honour — is worse than a plain row: it promises a
                  destination that does not exist. The chevron is the reference's
                  visual rhythm only, which is exactly what `aria-hidden` is for.
                  If capability detail pages ever ship, these become `<Link>`s and
                  the chevron earns its meaning.
                */}
                {shipped.length > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {shipped.map((cap, i) => {
                      // `?? ROW_TINTS[0]` satisfies `noUncheckedIndexedAccess`:
                      // a modulo is a plain `number`, so it resolves through the
                      // index signature and TS cannot see that it is always in
                      // range. The fallback is unreachable, not defensive.
                      const tint = ROW_TINTS[i % ROW_TINTS.length] ?? ROW_TINTS[0];
                      const RowIcon = tint.icon;
                      return (
                        <li
                          key={cap.id}
                          className="flex items-start gap-3.5 rounded-3xl bg-white p-4 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06] dark:bg-white/[0.04] dark:ring-white/10"
                        >
                          <span
                            aria-hidden
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tint.bg} ${tint.fg}`}
                          >
                            <RowIcon className="h-6 w-6" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-[15px] font-bold leading-tight">
                              {/*
                                A FILLED green disc with a white tick, per the
                                reference — and it keeps its label. The tick means
                                "shipped", which is the entire claim this page
                                makes, so it cannot be colour-only: the
                                `sr-only` word is what a screen reader and a
                                forced-colors user get.
                              */}
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                                <Check className="h-3 w-3" strokeWidth={3.5} />
                                <span className="sr-only">Available:</span>
                              </span>
                              {cap.name}
                            </p>
                            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-white/70">
                              {cap.description}
                            </p>
                          </div>
                          <ChevronRight
                            aria-hidden
                            className="mt-1 h-5 w-5 shrink-0 text-slate-300 dark:text-white/25"
                          />
                        </li>
                      );
                    })}
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
