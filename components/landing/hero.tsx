import { ArrowDown, CheckCircle2, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeroEffects } from "@/components/landing/hero-effects";
import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { Downloader } from "@/features/downloader/downloader";
import { SharedLinkDownloader } from "@/features/downloader/shared-link-downloader";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { PlatformId } from "@/types";

/** Platform marks shown under the "Download anything" card (public/newlanding.jpg). */
const SUPPORTED: PlatformId[] = ["tiktok", "twitter", "snapchat", "instagram", "facebook", "pinterest"];

/**
 * The reference checklist beneath the CTAs (public/newlandingfull.jpg). Every one
 * is a checkable product fact, not a scale claim — no account needed to download,
 * the downloader is free, and it is fast + secure — so they pass the Reality
 * Ledger for the same reason the stats band does: they describe what the thing IS.
 */
const CHECKS = ["No sign up required", "100% Free to use", "Fast & Secure"];

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
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-indigo-50/60 pb-12 pt-[calc(var(--frenz-safe-top)+7rem)] text-foreground dark:from-[#050816] dark:to-[#050816] dark:text-white sm:pb-16 sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
      <HeroEffects />

      <div className="container relative z-10 grid items-center gap-10 lg:grid-cols-2 lg:gap-8" id="hero">
        {/* Left — copy + CTAs */}
        <div className="text-center lg:text-left">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
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

          <p className="mx-auto mt-6 max-w-lg text-pretty text-base leading-relaxed text-slate-600 dark:text-white/70 sm:text-lg lg:mx-0">
            Frenz lets you download videos, photos, stories and reels — no watermark,
            full HD, completely free — from the platforms you already use. Then share,
            connect and explore, all in{" "}
            <span className="font-medium text-blue-600 dark:text-blue-300">one super app.</span>
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:items-start lg:justify-start">
            {/*
              Primary CTA goes straight to the paste-link tool, not to signup
              (owner, 2026-07-18). The downloader needs no account, so sending a
              visitor to /login first put a wall in front of the one thing the page
              is asking them to do. `#download` is the anchor on the tool below,
              which carries `scroll-mt-24` so the fixed header does not cover it.
            */}
            <Link
              href="#download"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-violet-600 to-fuchsia-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:opacity-95 active:scale-[0.99] sm:w-auto"
            >
              Start Downloading <ArrowDown className="h-4 w-4" />
            </Link>
            <Link
              href="/features"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 shadow-soft transition hover:border-slate-400 active:scale-[0.99] dark:border-white/15 dark:bg-white/5 dark:text-white dark:backdrop-blur dark:hover:border-white/30 sm:w-auto"
            >
              <Play className="h-4 w-4" /> Explore Features
            </Link>
          </div>

          {/* Reference checklist — three checkable product facts (no scale claims,
              so the Reality Ledger passes): no account needed, the downloader is
              free, and it is fast + secure. */}
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3 lg:justify-start">
            {CHECKS.map((label) => (
              <li key={label} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white/80">
                <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                {label}
              </li>
            ))}
          </ul>

          {/* Social proof — the reference's avatar stack, but WITHOUT a fabricated
              "50,000+ Happy Users" count or an invented star rating (there is no
              review system to source one). Illustrative cartoon avatars, never real
              faces, and an honest number-free line. See the Reality Ledger. */}
          <div className="mt-8 flex items-center justify-center gap-3 lg:justify-start">
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
          mockup below. */}
      <div id="download" className="container relative z-10 mt-12 max-w-3xl scroll-mt-24 sm:mt-14">
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
            <Suspense fallback={<Downloader />}>
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
        </div>
      </div>
    </section>
  );
}
