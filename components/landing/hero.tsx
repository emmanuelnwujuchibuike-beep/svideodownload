import {
  ArrowRight,
  Compass,
  Image as ImageIcon,
  Lock,
  Microscope,
  Shield,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeroEffects } from "@/components/landing/hero-effects";
import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { Downloader } from "@/features/downloader/downloader";
import { HeroCtaForm } from "@/features/downloader/hero-cta-form";
import { HeroLinkDownloader } from "@/features/downloader/hero-link-downloader";
import { SharedLinkDownloader } from "@/features/downloader/shared-link-downloader";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { PlatformId } from "@/types";

/** Platform marks shown under the "Download anything" card (public/newlanding.jpg). */
const SUPPORTED: PlatformId[] = ["tiktok", "twitter", "snapchat", "instagram", "facebook", "pinterest", "youtube", "telegram"];

/**
 * The trust row beneath the CTAs (public/upgraded landing page.jpg) — four
 * columns, each an icon disc, a claim and a two-line explanation.
 *
 * Every one is a checkable product FACT, not a scale claim: it is free, it needs
 * no account, it is fast, and the files go to the device rather than an account.
 * None of them asserts a user count or a rating — the Reality Ledger fails the
 * build on those, and there is no system behind either to make them true.
 */
const TRUST = [
  { label: "100% Free", detail: "Always free, forever", Icon: Shield, tone: "blue" },
  {
    label: "No Sign Up Required",
    detail: "Sign up only to track downloads across devices",
    Icon: Lock,
    tone: "violet",
  },
  { label: "Fast & Secure", detail: "Blazing fast downloads", Icon: Zap, tone: "blue" },
  { label: "Safe & Private", detail: "Your data stays yours", Icon: ShieldCheck, tone: "violet" },
] as const;

/**
 * The avatar stack's illustrated faces — cartoon avatars only, never a real
 * person's photo (this is public marketing). Deliberately NOT captioned with a
 * user count or a star rating: both would be unsourceable scale claims the ledger
 * fails the build on, and neither has a system behind it to make true.
 */
const FACES = [
  { name: "Amara", female: true, from: "from-rose-500 to-pink-500" },
  { name: "Kwame", female: false, from: "from-blue-500 to-indigo-500" },
  { name: "Lena", female: true, from: "from-violet-500 to-purple-500" },
  { name: "Diego", female: false, from: "from-emerald-500 to-teal-500" },
] as const;

export function Hero() {
  return (
    /*
     * Theme-aware, not pinned. `public/main landing page.jpg` is the DARK design;
     * light mode gets the same composition on a light ground — near-white with a
     * soft violet wash instead of near-black with neon.
     *
     * The effects layer carries its own light/dark pair (see hero-effects.tsx),
     * because neon trails that read as "light travelling" on #050816 read as dirt
     * on white. Same geometry, different palette and much lower intensity.
     */
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-indigo-50/60 pb-5 pt-[calc(var(--frenz-safe-top)+7rem)] text-foreground dark:from-[#050816] dark:to-[#050816] dark:text-white sm:pb-7 sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
      <HeroEffects />

      <div className="container relative z-10 grid items-center gap-10 lg:grid-cols-2 lg:gap-8" id="hero">
        {/* Left — copy + CTAs */}
        {/*
          Left-aligned at every width (owner, 2026-08-04: "the landing page hero
          section currently is center while in the image, the hero section is
          not").

          The reference (public/upgraded landing page.jpg) is a PHONE
          screenshot, and every element in it — eyebrow, headline, paragraph,
          CTA rows — starts at the same left margin. This column was
          `text-center lg:text-left`, so the one viewport the reference
          actually shows was the one viewport that did not match it.

          Left is also the better reading setup: a three-line headline and a
          four-line paragraph centred on a narrow screen give the eye a new
          starting point on every line, which is measurably slower to read.
        */}
        {/*
          🔴 `min-w-0` is load-bearing (owner, 2026-08-09: "the hero section
          spread to large screen when the top placeholder fetches a file, it
          breaks the mobile view").

          A grid item defaults to `min-width: auto`, which means it refuses to
          shrink below its content. The moment the CTA's result panel appeared in
          this column, the widest thing inside it — a format row, a long title —
          set the width of the whole grid TRACK, and the page grew past the
          viewport on a phone. Nothing was wrong with the panel; the column was
          simply never told it could be narrower than its contents.
        */}
        <div className="min-w-0 text-left">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
            <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
            All-in-One Downloader &amp; Social Hub
          </span>

          {/* "Download. Connect. Explore." — the reference H1, middle word in the
              brand gradient (public/newlandingfull.jpg). */}
          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-[-0.04em] text-slate-900 dark:text-white sm:text-6xl lg:text-[4.25rem]">
            Download.
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
              Connect.
            </span>
            <br />
            Explore.
          </h1>

          <p className="mt-6 max-w-lg text-pretty text-base leading-relaxed text-slate-600 dark:text-white/70 sm:text-lg">
            Frenz lets you download videos, photos, stories and reels — no watermark,
            full HD, completely free — from the platforms you already use. Then share,
            connect and explore, all in{" "}
            <span className="font-medium text-blue-600 dark:text-blue-300">one super app.</span>
          </p>

          {/* CTAs */}
          {/*
            CTA stack — the owner's reference (public/upgraded landing page.jpg).

            Three full-width rows, each an icon tile + title + one-line
            explanation + a trailing arrow, rather than three inline pills. The
            reference's own hierarchy: one loud primary, two calm secondaries.

            Every row is a plain server-rendered <Link>. The landing sits at its
            cold-entry ceiling with no headroom, so this section adds markup and
            CSS but not a single byte of client JavaScript — the arrows and the
            sheen are CSS, and nothing here hydrates.
          */}
          <div className="mt-8 flex flex-col gap-3">
            {/* Primary — goes straight to the paste-link tool (owner, 2026-07-18):
                the downloader needs no account, so a signup wall in front of the
                one thing the page asks for was the wrong door. */}
            {/*
              The CTA — a button that becomes a paste field. The transform is
              still pure CSS (see `.frenz-cta*` in globals.css); the island only
              exists to intercept the submit so the result appears in place
              instead of navigating. Full reasoning in hero-cta-form.tsx.
            */}
            <HeroCtaForm />

            <Link
              href="/features"
              className="group flex w-full items-center gap-4 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-left text-slate-900 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-card active:scale-[0.995] dark:border-white/15 dark:bg-white/5 dark:text-white dark:backdrop-blur dark:hover:border-white/30"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/70 dark:bg-white/10 dark:text-white dark:ring-white/15">
                <Compass className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold leading-tight">Explore Features</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/60">See what Frenz can do</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 dark:text-white/50" />
            </Link>

            {/*
              Wallpapers — opens the standalone library.

              Deliberately a plain server-rendered Link, NOT a client island. The
              first version was a client component warming the route on idle; it
              added a client boundary to the landing and pushed the page straight
              through the cold-entry budget (budget.test caught it at 303 kB). A
              Link with `prefetch` costs ZERO client JavaScript and still opens
              instantly — `loading.tsx` on /wallpapers does the rest.
            */}
            {/*
              ── The 2-second dwell cue (owner, 2026-08-09) ───────────────────
              "when a user stays at the button section for 2 secs, the wallpaper
              icon should animate premium attractive, writing a small text that
              says view with a microscope."

              Every part of it is CSS with a 2s `animation-delay` (see
              `.frenz-wp-*` in globals.css): the icon tile plays a short
              flourish, a light sweeps across it, and the microscope "View" cue
              fades in beside the title. No timer, no state, no client
              component — which is the only way to add this to a page that has
              no room left in its cold-entry budget.
            */}
            <Link
              href="/wallpapers"
              prefetch
              className="frenz-wp group flex w-full items-center gap-4 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-left shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-violet-400 hover:shadow-card active:scale-[0.995] dark:border-white/15 dark:bg-white/5 dark:backdrop-blur dark:hover:border-violet-400/40"
            >
              <span className="frenz-wp-icon relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-600 ring-1 ring-inset ring-violet-200/70 dark:from-violet-500/20 dark:to-fuchsia-500/15 dark:text-violet-300 dark:ring-violet-400/20">
                <ImageIcon className="relative h-5 w-5" />
                <span
                  aria-hidden
                  className="frenz-wp-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/25"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-base font-bold leading-tight text-violet-600 dark:text-violet-300">
                    Wallpaper Gallery
                  </span>
                  {/* The cue itself — a real label for what the tile does, not
                      decoration, so `prefers-reduced-motion` keeps it and drops
                      only the movement. */}
                  <span className="frenz-wp-cue inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-violet-600 ring-1 ring-inset ring-violet-200/70 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/25">
                    <Microscope className="h-3 w-3" />
                    View
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/60">
                  Stunning quality, updated daily
                </span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5" />
            </Link>

            {/*
              The hero CTA's own result — under the Wallpaper Gallery button,
              exactly where the tap happened (owner). Renders nothing at all
              without a `?paste=` link, so it costs the other 99% of visitors no
              markup and no layout. The Suspense boundary is what keeps `/`
              statically generated; its fallback is `null`, which is also the
              no-link state, so the static HTML and the hydrated page agree.
            */}
            <Suspense fallback={null}>
              <HeroLinkDownloader />
            </Suspense>
          </div>

          {/*
            Trust row — the reference's four columns, each an icon disc, a claim
            and a two-line explanation, divided by hairlines.

            Every one is a checkable product FACT, not a scale claim: free,
            no account, fast, and "your data stays yours". Nothing here asserts a
            user count or a rating, which the Reality Ledger would fail the build
            on and which there is no system behind to make true.
          */}
          <ul className="mt-8 grid grid-cols-4 gap-x-1 divide-x divide-slate-200/80 dark:divide-white/10">
            {TRUST.map(({ label, detail, Icon, tone }) => (
              <li key={label} className="flex flex-col items-center px-1 text-center">
                <span
                  className={
                    tone === "blue"
                      ? "flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                      : "flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
                  }
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="mt-2 text-[13px] font-bold leading-tight text-slate-900 dark:text-white">{label}</span>
                <span className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-white/60">{detail}</span>
              </li>
            ))}
          </ul>

          {/* Social proof — the reference's avatar stack, but WITHOUT a fabricated
              "50,000+ Happy Users" count or an invented star rating (there is no
              review system to source one). Illustrative cartoon avatars, never real
              faces, and an honest number-free line. See the Reality Ledger. */}
          <div className="mt-8 flex items-center justify-start gap-3">
            <div className="flex -space-x-2.5">
              {FACES.map((f) => (
                <span
                  key={f.name}
                  className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${f.from} ring-2 ring-background`}
                >
                  <BitmojiAvatar seed={f.name} female={f.female} className="h-full w-full" />
                </span>
              ))}
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-white/70">
              Built for creators &amp; everyday downloaders
            </p>
          </div>
        </div>

        {/* Right — phone mockup.
            pb reserves room for the download callout, which hangs ~56px BELOW the
            frame. Without it the chip collided with the "Paste a link to download"
            label under the hero — the callout is absolutely positioned, so it
            contributes no height of its own and nothing downstream knows it's there. */}
        <div className="relative pb-16 sm:pb-14">
          <PhoneMockup />
        </div>
      </div>

      {/* "Download anything" card — the purple paste-and-download panel from
          public/newlanding.jpg, sitting between the hero phone and the download
          mockup below.
          Uses its own (narrower) side padding instead of `container`'s 24px —
          the default made the card read as "tightly pressed" on phones; a
          smaller margin lets it spread closer to both edges, SnapTik-style,
          while keeping the same max-w-3xl cap everything else on the page uses. */}
      <div id="download" className="relative z-10 mx-auto mt-12 max-w-3xl scroll-mt-24 px-3 sm:mt-14 sm:px-6">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 p-5 shadow-elevated sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative text-center text-white">
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Download anything</h2>
            <p className="mt-1.5 text-sm text-white/80">Paste a link from any platform and download instantly.</p>
          </div>
          {/* The tool is prerendered into the static HTML by the fallback, then
              swapped for the identical tool pre-filled from a Share Target
              hand-off. Same markup either way, so nothing shifts — and the
              boundary is what lets `/` prerender at all (useSearchParams()
              suspends). See features/downloader/shared-link-downloader.tsx. */}
          <div className="relative mt-5">
            <Suspense fallback={<Downloader hideDisclaimer />}>
              <SharedLinkDownloader />
            </Suspense>
          </div>
          {/* Supported platforms, per the reference card. */}
          <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-semibold text-white/80">Supported Platforms:</span>
            {SUPPORTED.map((id) => {
              const Icon = BRAND_ICONS[id];
              return Icon ? (
                <span key={id} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-900 shadow-sm">
                  <Icon className="h-3.5 w-3.5" />
                </span>
              ) : null;
            })}
          </div>
          {/* Trademark / non-affiliation disclaimer — INSIDE the download box
              (owner), in a light tone that reads on the purple gradient. The tool
              inside hides its own copy on the landing so this isn't doubled. */}
          <DownloadDisclaimer className="relative mt-5 border-t border-white/15 pt-4 text-white/60" />
        </div>
      </div>
    </section>
  );
}
