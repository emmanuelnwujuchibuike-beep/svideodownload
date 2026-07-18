import { ArrowRight, Feather, Play, ShieldCheck, Smartphone, Sparkles, WifiOff } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeroEffects } from "@/components/landing/hero-effects";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { Downloader } from "@/features/downloader/downloader";
import { SharedLinkDownloader } from "@/features/downloader/shared-link-downloader";

/**
 * The four capability chips beneath the CTAs, per `public/main landing page.jpg`.
 *
 * Every one is a checkable product fact, not a scale claim: no app store (the PWA
 * is the product), offline via the service worker, no native install, and the
 * privacy posture already documented in the genome. They pass the Reality Ledger
 * for the same reason the stats band does — they describe what the thing IS.
 */
const CHIPS = [
  { icon: Smartphone, title: "No App Store", sub: "100% Web App" },
  { icon: WifiOff, title: "Works Offline", sub: "Smart Caching" },
  { icon: Feather, title: "Lightweight", sub: "Save Data & Storage" },
  { icon: ShieldCheck, title: "Secure", sub: "Your Data, Our Priority" },
];

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
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-indigo-50/60 pb-12 pt-28 text-foreground dark:from-[#050816] dark:to-[#050816] dark:text-white sm:pb-16 sm:pt-32">
      <HeroEffects />

      <div className="container relative z-10 grid items-center gap-10 lg:grid-cols-2 lg:gap-8" id="hero">
        {/* Left — copy + CTAs */}
        <div className="text-center lg:text-left">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
            <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
            All-in-One Platform
          </span>

          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-[-0.04em] text-slate-900 dark:text-white sm:text-6xl lg:text-[4.25rem]">
            Everything You Love.
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400 text-transparent">
              All in One
            </span>{" "}
            Place.
          </h1>

          <p className="mx-auto mt-6 max-w-lg text-pretty text-base leading-relaxed text-slate-600 dark:text-white/70 sm:text-lg lg:mx-0">
            Frenzsave is your super app for downloading, watching, creating, sharing and
            connecting. Save content. Create more. Earn rewards. All{" "}
            <span className="font-medium text-blue-600 dark:text-blue-300">without consuming your phone storage.</span>
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
              Download Now <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#platforms"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 shadow-soft transition hover:border-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:backdrop-blur dark:hover:border-white/30 active:scale-[0.99] sm:w-auto"
            >
              <Play className="h-4 w-4" /> Explore Features
            </Link>
          </div>

          {/* Four capability chips */}
          <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:gap-x-4">
            {CHIPS.map((chip) => (
              <div key={chip.title} className="text-left">
                <chip.icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{chip.title}</p>
                <p className="text-[11px] leading-tight text-slate-500 dark:text-white/50">{chip.sub}</p>
              </div>
            ))}
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

      {/* Premium paste-link & download bar — floats below the phone flagship */}
      <div id="download" className="container relative z-10 mt-12 max-w-2xl scroll-mt-24 sm:mt-14">
        <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-white/50">
          <span className="h-px w-8 bg-slate-300 dark:bg-white/20" /> Paste a link to download <span className="h-px w-8 bg-slate-300 dark:bg-white/20" />
        </div>
        {/* The tool is prerendered into the static HTML by the fallback, then
            swapped for the identical tool pre-filled from a Share Target
            hand-off. Same markup either way, so nothing shifts — and the
            boundary is what lets `/` prerender at all (useSearchParams()
            suspends). See features/downloader/shared-link-downloader.tsx. */}
        <Suspense fallback={<Downloader />}>
          <SharedLinkDownloader />
        </Suspense>
      </div>
    </section>
  );
}
