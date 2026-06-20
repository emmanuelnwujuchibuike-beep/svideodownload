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
    <section className="relative overflow-hidden pb-16 pt-24 sm:pt-32">
      {/* Ambient gradient + grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-grid-pattern bg-[size:42px_42px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-pink-500/30 via-fuchsia-500/20 to-cyan-400/20 blur-3xl"
      />

      <div className="container flex flex-col items-center text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-sm text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Powered by advanced media extraction · 1000+ platforms
        </div>

        <h1 className="max-w-4xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Download Videos From <span className="text-gradient">TikTok</span> &amp;{" "}
          1000+ Platforms
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
          Fast, secure, watermark-free downloads powered by advanced media
          extraction technology.
        </p>

        <div className="mt-10 w-full max-w-2xl">
          <Downloader />
        </div>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          {trust.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" /> {label}
            </li>
          ))}
        </ul>

        <div className="mt-12 w-full">
          <StatsCounter />
        </div>
      </div>
    </section>
  );
}
