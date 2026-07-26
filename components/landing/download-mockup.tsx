import { ArrowDownToLine, ClipboardPaste, Cloud, Download, FileVideo, Infinity as InfinityIcon, Wifi } from "lucide-react";

import { FEATURES } from "@/components/landing/features-grid";

/**
 * The second phone mockup — the "Downloads" app screen — with the six product
 * features floating around it, per `public/newlanding.jpg`. It follows the
 * "Download anything" paste card in the page flow, exactly as the reference shows.
 *
 * A decorative illustration (the numbers are the same illustrative kind the hero
 * phone uses — storage/size figures for a made-up account, never presented as site
 * stats). Server component, zero client JS, no `will-change`.
 */

function FeatureCard({ feature }: { feature: (typeof FEATURES)[number] }) {
  const Icon = feature.icon;
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${feature.tint} text-white shadow-sm`}>
        {feature.title === "HD Quality" ? <span className="text-[11px] font-extrabold">HD</span> : <Icon className="h-4 w-4" />}
      </span>
      <p className="mt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-white">{feature.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.desc}</p>
    </div>
  );
}

export function DownloadMockup() {
  const left = FEATURES.slice(0, 3);
  const right = FEATURES.slice(3, 6);

  return (
    <section className="container max-w-6xl py-8 sm:py-12">
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
        {/* Left feature cards */}
        <div className="order-2 grid grid-cols-2 gap-4 lg:order-1 lg:grid-cols-1">
          {left.map((f) => (
            <FeatureCard key={f.title} feature={f} />
          ))}
        </div>

        {/* Phone — Downloads screen */}
        <div className="order-1 mx-auto w-full max-w-[300px] lg:order-2">
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-blue-500/20 via-violet-500/15 to-purple-600/20 blur-3xl" />
            <div className="relative aspect-[776/1630] rounded-[2.6rem] border-[3px] border-neutral-800 bg-neutral-900 p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
              <div className="relative h-full overflow-hidden rounded-[2.35rem] border-[4px] border-black bg-neutral-50">
                {/* Dynamic Island */}
                <div className="absolute left-1/2 top-2 z-20 h-[1.3rem] w-[4.6rem] -translate-x-1/2 rounded-full bg-black" />

                <div className="flex h-full flex-col gap-2.5 px-3 pb-3 pt-2.5 text-neutral-900">
                  {/* status bar */}
                  <div className="flex items-center justify-between px-2 text-[10px] font-semibold text-neutral-900">
                    <span>12:20</span>
                    <span className="flex items-center gap-1.5">
                      <Wifi className="h-3 w-3" strokeWidth={2.5} />
                      <span className="relative h-[10px] w-[20px] rounded-[3px] ring-1 ring-neutral-900/70">
                        <span className="absolute inset-[1.5px] right-[3px] rounded-[1px] bg-neutral-900" />
                      </span>
                    </span>
                  </div>

                  {/* header */}
                  <div className="flex items-center justify-between px-1 pt-1">
                    <span className="text-base font-extrabold tracking-tight">Downloads</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow">
                      <ArrowDownToLine className="h-4 w-4" />
                    </span>
                  </div>

                  {/* paste bar */}
                  <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2.5 py-2 shadow-sm">
                    <span className="flex-1 truncate text-[10px] text-neutral-400">Paste any link here</span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-2 py-1 text-[9px] font-semibold text-neutral-600">
                      <ClipboardPaste className="h-2.5 w-2.5" /> Paste
                    </span>
                  </div>

                  {/* storage card */}
                  <div className="rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <span>
                        <span className="flex items-center gap-1 text-[10px] font-bold">
                          <Cloud className="h-3 w-3 text-violet-500" /> Storage used
                        </span>
                        <span className="mt-0.5 block text-[8px] text-neutral-400">Saved privately on your cloud · Business</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-extrabold">495 MB</span>
                        <span className="flex items-center justify-end gap-0.5 text-[8px] text-neutral-400">
                          of <InfinityIcon className="h-2.5 w-2.5" /> unlimited
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[8px] font-medium text-emerald-700">
                      Unlimited storage — no download limits on Business.
                    </div>
                  </div>

                  {/* two tiles */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
                      <Download className="h-3.5 w-3.5 text-violet-500" />
                      <p className="mt-1.5 text-base font-extrabold leading-none">60</p>
                      <p className="text-[9px] font-semibold text-neutral-500">Downloads</p>
                      <p className="text-[8px] text-neutral-400">All time</p>
                    </div>
                    <div className="rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
                      <FileVideo className="h-3.5 w-3.5 text-blue-500" />
                      <p className="mt-1.5 text-base font-extrabold leading-none">495 MB</p>
                      <p className="text-[9px] font-semibold text-neutral-500">Total size</p>
                      <p className="text-[8px] text-neutral-400">avg 8.3 MB</p>
                    </div>
                  </div>

                  {/* recent */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold">Recent Downloads</span>
                      <span className="text-[9px] font-semibold text-violet-500">See all</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-sm">
                      <span className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-rose-400 to-fuchsia-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-semibold">Video.mp4</span>
                        <span className="block text-[8px] text-neutral-400">12.5 MB · MP4</span>
                      </span>
                      <ArrowDownToLine className="h-3.5 w-3.5 text-violet-500" />
                    </div>
                  </div>

                  <div className="flex-1" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right feature cards */}
        <div className="order-3 grid grid-cols-2 gap-4 lg:grid-cols-1">
          {right.map((f) => (
            <FeatureCard key={f.title} feature={f} />
          ))}
        </div>
      </div>
    </section>
  );
}
