"use client";

import {
  Check,
  ClipboardPaste,
  Download,
  Droplet,
  Gauge,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Music,
  Play,
  Share2,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

// Steps for the built-in animated demo (used when no promo video is present).
const STEPS = [
  { icon: ClipboardPaste, label: "Paste your TikTok link" },
  { icon: Loader2, label: "Fetching · removing watermark" },
  { icon: Download, label: "Downloading in HD" },
  { icon: Check, label: "Saved to camera roll" },
];

export function TikTokFlagship() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [hasRealVideo, setHasRealVideo] = useState(false);
  const [step, setStep] = useState(0);

  // Cycle the built-in demo while "playing" and there's no real clip.
  useEffect(() => {
    if (!playing || hasRealVideo) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1400);
    return () => clearInterval(id);
  }, [playing, hasRealVideo]);

  const play = () => {
    setPlaying(true);
    setStep(0);
    videoRef.current
      ?.play()
      .then(() => setHasRealVideo(true))
      .catch(() => setHasRealVideo(false)); // no clip → built-in demo runs
  };

  const stop = () => {
    videoRef.current?.pause();
    setPlaying(false);
    setHasRealVideo(false);
  };

  const Stage = STEPS[step]!;
  const progress = ((step + 1) / STEPS.length) * 100;

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
          <div className="absolute -left-5 top-16 z-20 motion-safe:animate-float rounded-2xl border border-white/10 bg-background/90 px-3 py-2 text-center shadow-xl">
            <p className="text-lg font-bold text-gradient">4K</p>
            <p className="text-[10px] text-muted-foreground">Ultra HD</p>
          </div>
          <div className="absolute -right-4 bottom-28 z-20 motion-safe:animate-float rounded-2xl border border-white/10 bg-background/90 px-3 py-2 text-center shadow-xl [animation-delay:1.2s]">
            <p className="text-lg font-bold text-gradient">MP3</p>
            <p className="text-[10px] text-muted-foreground">Audio</p>
          </div>

          {/* Phone */}
          <div className="glass aspect-[9/19] rounded-[2.5rem] p-2 shadow-2xl">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-zinc-950">
              {/* Rich, on-brand animated cover */}
              <div className="absolute inset-0 bg-[conic-gradient(from_210deg_at_30%_20%,#1d4ed8,#0ea5e9,#22d3ee,#2563eb,#1d4ed8)]" />
              <div
                aria-hidden
                className="absolute inset-0 opacity-70 [background:radial-gradient(90%_60%_at_15%_0%,rgba(255,255,255,0.35),transparent_55%),radial-gradient(90%_70%_at_100%_100%,rgba(2,6,23,0.7),transparent_60%)]"
              />
              <div
                aria-hidden
                className="absolute inset-0 motion-safe:animate-float bg-grid-pattern bg-[size:26px_26px] opacity-[0.18]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-x-10 top-1/3 h-40 -rotate-12 bg-white/10 blur-2xl"
              />

              {/* Optional real promo clip */}
              <video
                ref={videoRef}
                src={DEMO_SRC}
                muted
                loop
                playsInline
                preload="none"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  playing && hasRealVideo ? "opacity-100" : "opacity-0"
                }`}
              />

              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/70" />

              {/* Header */}
              <div className="relative z-10 flex items-center justify-between p-4 text-xs font-medium text-white">
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

              {/* Center: play button OR live demo */}
              <div className="relative z-10 flex flex-1 items-center justify-center px-6">
                {!playing ? (
                  <button
                    type="button"
                    onClick={play}
                    aria-label="Play preview"
                    className="relative flex items-center justify-center"
                  >
                    <span className="absolute h-24 w-24 motion-safe:animate-ping rounded-full bg-white/15" />
                    <span className="absolute h-32 w-32 motion-safe:animate-pulse rounded-full border border-white/20" />
                    <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-2xl transition-transform active:scale-95">
                      <Play className="h-6 w-6 translate-x-0.5 fill-blue-600 text-blue-600" />
                    </span>
                  </button>
                ) : hasRealVideo ? null : (
                  <div className="w-full rounded-2xl border border-white/15 bg-black/35 p-4 backdrop-blur-md">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600">
                        <Stage.icon
                          className={`h-5 w-5 ${step === 1 ? "animate-spin" : ""}`}
                        />
                      </span>
                      <p className="text-sm font-semibold text-white">{Stage.label}</p>
                    </div>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-white to-cyan-200 transition-all duration-700"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Right action rail */}
                {!playing ? (
                  <span className="absolute right-3 flex flex-col items-center gap-4">
                    <RailIcon icon={Heart} label="2.4M" tint="text-sky-200" />
                    <RailIcon icon={MessageCircle} label="18K" />
                    <RailIcon icon={Share2} label="Share" />
                    <span className="flex h-9 w-9 animate-[spin_5s_linear_infinite] items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-black ring-2 ring-white/40">
                      <Music className="h-4 w-4 text-white" />
                    </span>
                  </span>
                ) : null}
              </div>

              {/* Footer */}
              <div className="relative z-10 p-4">
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

                <button
                  type="button"
                  onClick={playing ? stop : play}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-blue-600 shadow-lg transition active:scale-[0.98]"
                >
                  {playing ? (
                    <>Tap to replay</>
                  ) : (
                    <>
                      <Droplet className="h-4 w-4" /> Download HD
                    </>
                  )}
                </button>
              </div>
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
