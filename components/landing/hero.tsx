import { StatsCounter } from "@/components/landing/stats-counter";
import { Downloader } from "@/features/downloader/downloader";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-24 pt-32 sm:pb-32 sm:pt-44">
      {/* Dot grid — no z-index so it stays inside this section's paint order */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.22] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)]"
      />

      <div className="container flex flex-col items-center text-center">
        {/* Live badge */}
        <a
          href="#flagship"
          className="group mb-8 inline-flex items-center gap-2.5 rounded-full border border-border/60 bg-card/70 px-4 py-2 text-sm font-medium text-muted-foreground shadow-soft backdrop-blur-sm transition-colors hover:border-foreground/15 hover:text-foreground"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          All major platforms supported
          <span className="text-muted-foreground/50 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </a>

        {/* Main heading */}
        <h1 className="max-w-4xl text-[2.6rem] font-bold leading-[1.04] tracking-[-0.04em] sm:text-[3.75rem] lg:text-[4.5rem]">
          Download &amp; meet new friends with{" "}
          <span className="text-gradient">
            the latest news
            <br className="hidden sm:block" /> and reels
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-xl">
          Paste any link — get a clean, watermark-free file in seconds. Fast,
          secure, and completely free. No login required.
        </p>

        {/* Downloader widget */}
        <div id="download" className="mt-12 w-full max-w-2xl scroll-mt-24">
          <Downloader />
        </div>

        {/* Platform badges */}
        <div className="mt-12 flex flex-col items-center gap-4">
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

        <div className="mt-16 w-full sm:mt-20">
          <StatsCounter />
        </div>
      </div>
    </section>
  );
}
