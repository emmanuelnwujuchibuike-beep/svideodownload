import { ShieldCheck, Sparkles, Zap } from "lucide-react";

import { StatsCounter } from "@/components/landing/stats-counter";
import { Downloader } from "@/features/downloader/downloader";

const trust = [
  { icon: ShieldCheck, label: "No login required" },
  { icon: Zap, label: "Ultra-fast processing" },
  { icon: Sparkles, label: "Watermark-free HD" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pb-28 sm:pt-40">
      {/* Ambient grid + single restrained glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-grid-pattern bg-[size:44px_44px] opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-10%] -z-10 h-[520px] w-[880px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-pink-500/20 via-fuchsia-500/10 to-cyan-400/15 blur-[120px]"
      />

      <div className="container flex flex-col items-center text-center">
        <a
          href="#platforms"
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
          Download any video,
          <br className="hidden sm:block" /> from{" "}
          <span className="text-gradient">TikTok</span> to anywhere.
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Paste a link, get a clean, watermark-free file in seconds. Fast,
          secure, and free — no app, no login.
        </p>

        <div className="mt-12 w-full max-w-2xl">
          <Downloader />
        </div>

        <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-muted-foreground">
          {trust.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" /> {label}
            </li>
          ))}
        </ul>

        <div className="mt-16 w-full sm:mt-20">
          <StatsCounter />
        </div>
      </div>
    </section>
  );
}
