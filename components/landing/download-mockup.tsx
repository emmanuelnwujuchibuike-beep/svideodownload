import { ArrowDownToLine, Box, ClipboardPaste, Cloud, Download, Infinity as InfinityIcon, ShoppingBag, Wifi } from "lucide-react";

import { FEATURES } from "@/components/landing/features-grid";

/**
 * The "Downloads" phone mockup + the six download features, per
 * `public/download mockup.jpg`.
 *
 * ── Layout (owner) ────────────────────────────────────────────────────────────
 *
 * The phone stands ALONE first, in its own block — a 3D-angled device (like the
 * hero feed phone, but bent the OPPOSITE way). The feature cards are a SEPARATE
 * block BELOW it, in a 3-column grid — never packed around the phone.
 *
 * A decorative illustration (the storage/size figures are the same illustrative
 * kind the hero phone uses — a made-up account, never presented as site stats).
 * The tilt is a static transform, painted once; server component, zero client JS.
 */

function FeatureCard({ feature }: { feature: (typeof FEATURES)[number] }) {
  const Icon = feature.icon;
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft sm:p-5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${feature.tint} text-white shadow-sm sm:h-11 sm:w-11`}>
        {feature.title === "HD Quality" ? <span className="text-xs font-extrabold">HD</span> : <Icon className="h-4 w-4 sm:h-5 sm:w-5" />}
      </span>
      <p className="mt-3 text-sm font-bold leading-tight tracking-tight text-slate-900 dark:text-white">{feature.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.desc}</p>
    </div>
  );
}

export function DownloadMockup() {
  return (
    <section className="container max-w-6xl py-10 sm:py-16">
      {/* Phone alone — 3D angled, tilted the opposite way to the hero feed phone. */}
      <div className="relative mx-auto w-full max-w-[300px]">
        <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-blue-500/25 via-violet-500/18 to-purple-600/25 blur-3xl" />
        <div aria-hidden className="absolute inset-x-8 bottom-1 -z-10 h-10 rounded-[50%] bg-black/30 blur-2xl dark:bg-black/60" />

        <div className="[transform:perspective(1600px)_rotateX(4deg)_rotateY(15deg)_rotateZ(-2deg)] [transform-style:preserve-3d]">
          {/* Titanium frame */}
          <div className="relative aspect-[776/1630] rounded-[2.6rem] bg-[linear-gradient(260deg,#fafafa_0%,#d4d4d8_4%,#71717a_13%,#3f3f46_34%,#27272a_50%,#3f3f46_66%,#71717a_87%,#d4d4d8_96%,#fafafa_100%)] p-[3px] shadow-[0_0_0_0.5px_rgba(255,255,255,0.35),inset_0_1px_1px_rgba(255,255,255,0.6),0_18px_30px_-8px_rgba(0,0,0,0.4),0_40px_60px_-16px_rgba(0,0,0,0.5),0_70px_100px_-30px_rgba(0,0,0,0.55)]">
            <div className="relative h-full overflow-hidden rounded-[2.45rem] border-[4px] border-black bg-neutral-50">
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

                {/* header — "Downloads" + light lavender download button */}
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-base font-extrabold tracking-tight">Downloads</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
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
                      <span className="mt-0.5 block text-[8px] leading-tight text-neutral-400">Saved privately on your<br />private cloud · Business.</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-extrabold">495 MB</span>
                      <span className="flex items-center justify-end gap-0.5 text-[8px] text-neutral-400">
                        of <InfinityIcon className="h-2.5 w-2.5" /> unlimited
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-[8px] font-medium text-emerald-700">
                    <ShoppingBag className="h-2.5 w-2.5 shrink-0" /> Unlimited storage — no download limits on Business.
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
                    <Box className="h-3.5 w-3.5 text-blue-500" />
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

      {/* Feature cards — a SEPARATE block below the phone, in a 3-column grid. */}
      <div className="mt-14 grid grid-cols-2 gap-4 sm:mt-20 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} feature={f} />
        ))}
      </div>
    </section>
  );
}
