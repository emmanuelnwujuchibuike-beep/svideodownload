"use client";

import {
  Download,
  Droplet,
  Gauge,
  Heart,
  MessageCircle,
  MousePointerClick,
  Music,
  Play,
  Share2,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { Reveal } from "@/components/ui/reveal";

const features = [
  { icon: Droplet, title: "No Watermark", body: "Clean exports with the TikTok watermark removed automatically." },
  { icon: Sparkles, title: "HD Downloads", body: "Original resolution up to 1080p and beyond when available." },
  { icon: Gauge, title: "Ultra-Fast Processing", body: "Edge-cached extraction returns your file in seconds." },
  { icon: Smartphone, title: "Mobile Friendly", body: "Designed mobile-first — save straight to your camera roll." },
  { icon: MousePointerClick, title: "One-Click Download", body: "Paste, preview, download. No accounts, no friction." },
];

// Drop a short vertical promo clip at public/flagship-demo.mp4 to feature it.
const DEMO_SRC = "/flagship-demo.mp4";

export function TikTokFlagship() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false)); // no/blocked source → keep the cover
  };

  return (
    <section className="relative overflow-hidden border-t border-border/60 py-28 sm:py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 -z-10 h-96 w-96 -translate-y-1/2 rounded-full bg-blue-500/15 blur-3xl"
      />
      <div className="container grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
            Flagship · TikTok
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.75rem] sm:leading-[1.1]">
            The fastest way to save{" "}
            <span className="text-gradient">TikTok</span> videos
          </h2>
          <p className="mt-5 max-w-md text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            SVideoDownload is built TikTok-first. Drop any video, photo carousel,
            or sound link and get a pristine, watermark-free file in moments.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <div className="relative mx-auto w-full max-w-[300px]">
          {/* Floating quality badges */}
          <div className="absolute -left-5 top-16 z-20 animate-float rounded-2xl border border-white/10 bg-background/80 px-3 py-2 text-center shadow-xl backdrop-blur">
            <p className="text-lg font-bold text-gradient">4K</p>
            <p className="text-[10px] text-muted-foreground">Ultra HD</p>
          </div>
          <div className="absolute -right-4 bottom-28 z-20 animate-float rounded-2xl border border-white/10 bg-background/80 px-3 py-2 text-center shadow-xl backdrop-blur [animation-delay:1.2s]">
            <p className="text-lg font-bold text-gradient">MP3</p>
            <p className="text-[10px] text-muted-foreground">Audio</p>
          </div>

          {/* Phone */}
          <div className="glass aspect-[9/19] rounded-[2.5rem] p-2 shadow-2xl">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-zinc-900">
              {/* Branded, on-brand cover (replaces the old random stock photo) */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-sky-600 to-cyan-500" />
              <div
                aria-hidden
                className="absolute inset-0 opacity-60 [background:radial-gradient(120%_80%_at_20%_10%,rgba(255,255,255,0.25),transparent_55%),radial-gradient(120%_90%_at_90%_90%,rgba(8,47,73,0.6),transparent_60%)]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-grid-pattern bg-[size:26px_26px] opacity-[0.15]"
              />

              {/* The promo video (hidden until it can play) */}
              <video
                ref={videoRef}
                src={DEMO_SRC}
                muted
                loop
                playsInline
                preload="none"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  playing ? "opacity-100" : "opacity-0"
                }`}
              />

              {/* Cinematic overlay for legibility (fades out while playing) */}
              <div
                className={`absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/70 transition-opacity duration-500 ${
                  playing ? "opacity-0" : "opacity-100"
                }`}
              />

              {/* Cover UI — hidden once the video is playing */}
              <div
                className={`relative z-10 flex h-full flex-col transition-opacity duration-500 ${
                  playing ? "pointer-events-none opacity-0" : "opacity-100"
                }`}
              >
                {/* Status / header */}
                <div className="flex items-center justify-between p-4 text-xs font-medium text-white">
                  <span className="flex items-center gap-1.5 font-bold">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/20">
                      <Download className="h-3 w-3" />
                    </span>
                    SVideoDownload
                  </span>
                  <span className="rounded-full bg-green-500/30 px-2 py-0.5 text-green-100 backdrop-blur">
                    No watermark
                  </span>
                </div>

                {/* Center play button */}
                <button
                  type="button"
                  onClick={play}
                  aria-label="Play preview"
                  className="relative flex flex-1 items-center justify-center"
                >
                  <span className="absolute h-24 w-24 animate-ping rounded-full bg-white/15" />
                  <span className="absolute h-32 w-32 animate-pulse rounded-full border border-white/20" />
                  <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-2xl transition-transform active:scale-95">
                    <Play className="h-6 w-6 translate-x-0.5 fill-blue-600 text-blue-600" />
                  </span>

                  {/* Right action rail */}
                  <span className="absolute right-3 flex flex-col items-center gap-4">
                    <RailIcon icon={Heart} label="2.4M" tint="text-sky-200" />
                    <RailIcon icon={MessageCircle} label="18K" />
                    <RailIcon icon={Share2} label="Share" />
                    <span className="flex h-9 w-9 animate-[spin_5s_linear_infinite] items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-black ring-2 ring-white/40">
                      <Music className="h-4 w-4 text-white" />
                    </span>
                  </span>
                </button>

                {/* Creator + caption + animated download */}
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-300 to-cyan-200 ring-2 ring-white/60" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        Paste · Preview · Download
                      </p>
                      <p className="truncate text-[11px] text-white/80">
                        ♪ watermark-free HD
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                    <div className="shimmer h-full w-2/3 rounded-full bg-white" />
                  </div>

                  <div className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-blue-600 shadow-lg">
                    <Droplet className="h-4 w-4" /> Download HD
                  </div>
                </div>
              </div>

              {/* Tap-to-pause when playing */}
              {playing ? (
                <button
                  type="button"
                  aria-label="Pause preview"
                  onClick={() => {
                    videoRef.current?.pause();
                    setPlaying(false);
                  }}
                  className="absolute inset-0 z-10"
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RailIcon({
  icon: Icon,
  label,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  tint?: string;
}) {
  return (
    <span className="flex flex-col items-center gap-0.5 text-white">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/20 backdrop-blur">
        <Icon className={`h-4 w-4 ${tint ?? "text-white"}`} />
      </span>
      <span className="text-[10px] font-medium text-white/90">{label}</span>
    </span>
  );
}
