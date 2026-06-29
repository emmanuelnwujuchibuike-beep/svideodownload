import { Lock, Play, Plus, Sparkles, UserX, Zap } from "lucide-react";
import Link from "next/link";

import { PhoneMockup } from "@/components/landing/phone-mockup";
import { Downloader } from "@/features/downloader/downloader";

const TRUST = [
  { icon: UserX, label: "No Login Required", tint: "text-blue-500" },
  { icon: Lock, label: "100% Secure & Private", tint: "text-emerald-500" },
  { icon: Zap, label: "Fast Downloads", tint: "text-violet-500" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-12 pt-28 sm:pb-16 sm:pt-32">
      <div className="container grid items-center gap-10 lg:grid-cols-2 lg:gap-8" id="hero">
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

          {/* Trust points */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
            {TRUST.map((t) => (
              <span key={t.label} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-secondary ${t.tint}`}>
                  <t.icon className="h-4 w-4" />
                </span>
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Right — phone mockup */}
        <div className="relative">
          <PhoneMockup />
        </div>
      </div>

      {/* Premium paste-link & download bar — floats below the phone flagship */}
      <div id="download" className="container mt-12 max-w-2xl scroll-mt-24 sm:mt-14">
        <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          <span className="h-px w-8 bg-border" /> Paste a link to download <span className="h-px w-8 bg-border" />
        </div>
        <Downloader />
      </div>
    </section>
  );
}
