import { Lock, Sparkles, UserX, Zap } from "lucide-react";

import { Downloader } from "@/features/downloader/downloader";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";

const TRUST = [
  { icon: UserX, label: "No login required" },
  { icon: Lock, label: "100% secure & private" },
  { icon: Zap, label: "Fast downloads" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-36">
      {/* Dot grid — stays inside this section's paint order */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.22] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)]"
      />

      <div className="container flex flex-col items-center text-center">
        {/* Badge */}
        <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-soft backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          All-in-one social super app
        </span>

        {/* Main heading */}
        <h1 className="max-w-3xl text-[2.7rem] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[4rem] lg:text-[4.5rem]">
          Download. Discover. <span className="text-gradient">Connect.</span>
        </h1>

        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Download videos, watch trending reels, stay updated with the latest news, meet new
          friends and chat in real time — all in one place.
        </p>

        {/* Downloader widget — paste a link & download, right at the top */}
        <div id="download" className="mt-10 w-full max-w-2xl scroll-mt-24">
          <Downloader />
        </div>

        {/* Trust points */}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {TRUST.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-1.5">
              <t.icon className="h-4 w-4 text-primary" /> {t.label}
            </span>
          ))}
        </div>

        {/* Platform badges */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/60">
            Built for the platforms you love
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {FLAGSHIP_IDS.map((id) => {
              const platform = PLATFORMS[id];
              const Icon = BRAND_ICONS[id];
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3.5 py-1.5 text-sm font-medium shadow-soft transition-colors hover:border-foreground/20"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ${platform.accent} text-white shadow-sm`}
                  >
                    {Icon ? <Icon className="h-3 w-3" /> : null}
                  </span>
                  {platform.name}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
