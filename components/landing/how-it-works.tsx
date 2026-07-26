import { Download, FolderClock, Sparkles, Wand2, Zap } from "lucide-react";

import { BRAND_ICONS } from "@/lib/platform-icons";
import type { PlatformId } from "@/types";

/**
 * "How it works — 3 Simple Steps. That's it." per `public/newlandingfull.jpg`.
 * Left: the three steps. Middle: a phone with the paste box + supported-platform
 * grid and a floating "downloading" progress card. Right: three supporting notes.
 * Server component, zero client JS.
 */

const STEPS = [
  { n: 1, title: "Paste your link", desc: "Copy and paste the link from any platform you want to download." },
  { n: 2, title: "Click Download", desc: "We process the link and prepare your download." },
  { n: 3, title: "Save & Enjoy", desc: "Download in the quality you want and enjoy offline." },
];

const NOTES = [
  { icon: Wand2, title: "Clean & Easy Interface", desc: "Designed for everyone." },
  { icon: Zap, title: "Real-time Progress", desc: "Track your downloads." },
  { icon: FolderClock, title: "Download History", desc: "Access anytime, anywhere." },
];

const GRID_PLATFORMS: PlatformId[] = [
  "tiktok", "instagram", "facebook", "twitter", "youtube", "pinterest",
  "snapchat", "reddit", "vimeo", "threads", "linkedin",
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="container max-w-6xl scroll-mt-24 py-14 sm:py-20">
      <div className="mb-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
          <Sparkles className="h-3.5 w-3.5" /> How it works
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl">
          3{" "}
          <span className="bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-fuchsia-400">
            Simple
          </span>{" "}
          Steps. That&rsquo;s it.
        </h2>
      </div>

      <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto_1fr]">
        {/* Steps */}
        <ol className="order-2 space-y-6 lg:order-1">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white shadow">
                {s.n}
              </span>
              <span>
                <span className="block font-bold tracking-tight text-slate-900 dark:text-white">{s.title}</span>
                <span className="mt-0.5 block max-w-xs text-sm leading-relaxed text-muted-foreground">{s.desc}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* Phone */}
        <div className="order-1 mx-auto w-full max-w-[280px] lg:order-2">
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-blue-500/20 to-violet-600/20 blur-3xl" />
            <div className="relative aspect-[776/1630] rounded-[2.6rem] border-[3px] border-neutral-800 bg-neutral-900 p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
              <div className="relative h-full overflow-hidden rounded-[2.35rem] border-[4px] border-black bg-neutral-50">
                <div className="absolute left-1/2 top-2 z-20 h-[1.3rem] w-[4.6rem] -translate-x-1/2 rounded-full bg-black" />
                <div className="flex h-full flex-col gap-3 px-3 pb-3 pt-7 text-neutral-900">
                  <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2.5 py-2 shadow-sm">
                    <span className="flex-1 truncate text-[10px] text-neutral-400">Paste your link here…</span>
                  </div>
                  <div className="rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 py-2 text-center text-[11px] font-semibold text-white">Download</div>
                  <span className="text-[10px] font-bold">Supported Platforms</span>
                  <div className="grid grid-cols-4 gap-2">
                    {GRID_PLATFORMS.map((id) => {
                      const Icon = BRAND_ICONS[id];
                      return (
                        <span key={id} className="flex aspect-square items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-800 shadow-sm">
                          {Icon ? <Icon className="h-4 w-4" /> : null}
                        </span>
                      );
                    })}
                    <span className="flex aspect-square items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 text-[9px] font-semibold text-neutral-500 shadow-sm">+More</span>
                  </div>
                  <div className="flex-1" />
                </div>
              </div>
            </div>

            {/* Floating "downloading" card */}
            <div className="absolute -right-4 top-8 w-44 rounded-2xl border border-border/70 bg-card p-3 shadow-elevated sm:-right-10">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-300">
                  <Download className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold">Downloading</span>
                  <span className="block truncate text-[9px] text-muted-foreground">Video.mp4</span>
                </span>
                <span className="text-[10px] font-bold text-blue-600">85%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-[85%] rounded-full bg-gradient-to-r from-blue-500 to-violet-600" />
              </div>
              <div className="mt-2 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                <Zap className="h-3 w-3 text-amber-500" /> High speed download
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <ul className="order-3 space-y-5">
          {NOTES.map((n) => (
            <li key={n.title} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
                <n.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-900 dark:text-white">{n.title}</span>
                <span className="block text-xs text-muted-foreground">{n.desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
