import { Lock, Play, Plus, Sparkles, UserX, Zap } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HeroWave } from "@/components/landing/hero-wave";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { Downloader } from "@/features/downloader/downloader";
import { SharedLinkDownloader } from "@/features/downloader/shared-link-downloader";

const TRUST = [
  { icon: UserX, line1: "No Login", line2: "Required", tint: "text-blue-500" },
  { icon: Lock, line1: "100% Secure", line2: "& Private", tint: "text-emerald-500" },
  { icon: Zap, line1: "Fast", line2: "Downloads", tint: "text-violet-500" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-12 pt-28 sm:pb-16 sm:pt-32">
      <HeroWave />

      <div className="container relative grid items-center gap-10 lg:grid-cols-2 lg:gap-8" id="hero">
        {/* Left — copy + CTAs */}
        <div className="text-center lg:text-left">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500/10 to-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            All-in-one social super app
          </span>

          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-[4.5rem]">
            Download.<br />
            Discover.<br />
            <span className="text-gradient">Connect.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            Download videos, watch trending reels, stay updated with the latest news, meet new
            friends, and chat in real time — all in one place.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:items-start lg:justify-start">
            <Link
              href="#download"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.99] sm:w-auto"
            >
              <Plus className="h-4 w-4" /> Get Started Free
            </Link>
            <Link
              href="/explore"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-7 py-3.5 text-sm font-semibold text-foreground shadow-soft transition hover:border-foreground/20 active:scale-[0.99] sm:w-auto"
            >
              <Play className="h-4 w-4" /> Explore Features
            </Link>
          </div>

          {/* Trust points — icon + two-line label, divided */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 lg:justify-start">
            {TRUST.map((t, i) => (
              <span key={t.line1} className="flex items-center">
                {i > 0 ? <span aria-hidden className="mr-5 hidden h-8 w-px bg-border sm:block" /> : null}
                <span className="inline-flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-secondary ${t.tint}`}>
                    <t.icon className="h-4 w-4" />
                  </span>
                  <span className="text-left text-sm font-medium leading-tight text-muted-foreground">
                    {t.line1}<br />{t.line2}
                  </span>
                </span>
              </span>
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
      <div id="download" className="container relative mt-12 max-w-2xl scroll-mt-24 sm:mt-14">
        <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          <span className="h-px w-8 bg-border" /> Paste a link to download <span className="h-px w-8 bg-border" />
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
