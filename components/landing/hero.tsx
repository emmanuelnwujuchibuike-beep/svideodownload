import { StatsCounter } from "@/components/landing/stats-counter";
import { Downloader } from "@/features/downloader/downloader";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pb-28 sm:pt-40">
      {/* Ambient grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-grid-pattern bg-[size:44px_44px] opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]"
      />
      {/* Premium gradient glow — vibrant in both light and dark */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-12%] -z-10 h-[560px] w-[920px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-blue-500/35 via-sky-500/25 to-cyan-400/30 blur-[110px]"
      />

      <div className="container flex flex-col items-center text-center">
        <a
          href="#flagship"
          className="group mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-sm text-muted-foreground shadow-soft backdrop-blur transition-colors hover:text-foreground"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          1000+ platforms supported
          <span className="text-muted-foreground/50 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </a>

        <h1 className="max-w-4xl text-balance text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
          Download from{" "}
          <span className="text-gradient">TikTok, Instagram, YouTube</span>
          <br className="hidden sm:block" /> &amp; 1000+ more.
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Paste a link, get a clean, watermark-free file in seconds. Fast,
          secure, and completely free — no login required.
        </p>

        <div id="download" className="mt-12 w-full max-w-2xl scroll-mt-24">
          <Downloader />
        </div>

        {/* Featured platforms */}
        <div className="mt-10 flex flex-col items-center gap-3.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
            Built for the platforms you love
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {FLAGSHIP_IDS.map((id) => {
              const platform = PLATFORMS[id];
              const Icon = BRAND_ICONS[id];
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-sm font-medium shadow-soft backdrop-blur transition-colors hover:border-foreground/20"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ${platform.accent} text-white`}
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
