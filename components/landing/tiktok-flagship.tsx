import {
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

import { Reveal } from "@/components/ui/reveal";

const features = [
  { icon: Droplet, title: "No Watermark", body: "Clean exports with the TikTok watermark removed automatically." },
  { icon: Sparkles, title: "HD Downloads", body: "Original resolution up to 1080p and beyond when available." },
  { icon: Gauge, title: "Ultra-Fast Processing", body: "Edge-cached extraction returns your file in seconds." },
  { icon: Smartphone, title: "Mobile Friendly", body: "Designed mobile-first — save straight to your camera roll." },
  { icon: MousePointerClick, title: "One-Click Download", body: "Paste, preview, download. No accounts, no friction." },
];

export function TikTokFlagship() {
  return (
    <section className="relative overflow-hidden border-t border-border/60 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 -z-10 h-96 w-96 -translate-y-1/2 rounded-full bg-pink-500/20 blur-3xl"
      />
      <div className="container grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary">
            Flagship · TikTok
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            The fastest way to save{" "}
            <span className="text-gradient">TikTok</span> videos
          </h2>
          <p className="mt-4 text-muted-foreground">
            SVideoDownload is built TikTok-first. Drop any video, photo carousel,
            or sound link and get a pristine, watermark-free file in moments.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-cyan-400 text-white">
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
          <div className="absolute -left-5 top-16 z-10 animate-float rounded-2xl border border-white/10 bg-background/80 px-3 py-2 text-center shadow-xl backdrop-blur">
            <p className="text-lg font-bold text-gradient">4K</p>
            <p className="text-[10px] text-muted-foreground">Ultra HD</p>
          </div>
          <div className="absolute -right-4 bottom-28 z-10 animate-float rounded-2xl border border-white/10 bg-background/80 px-3 py-2 text-center shadow-xl backdrop-blur [animation-delay:1.2s]">
            <p className="text-lg font-bold text-gradient">MP3</p>
            <p className="text-[10px] text-muted-foreground">Audio</p>
          </div>

          {/* Phone */}
          <div className="glass aspect-[9/19] rounded-[2.5rem] p-2 shadow-2xl">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-gradient-to-b from-pink-500/40 via-fuchsia-600/25 to-cyan-500/25">
              {/* Status / header */}
              <div className="flex items-center justify-between p-4 text-xs font-medium text-white/90">
                <span>TikTok</span>
                <span className="rounded-full bg-green-500/25 px-2 py-0.5 text-green-200">
                  No watermark
                </span>
              </div>

              {/* Center play button with pulsing rings */}
              <div className="relative flex flex-1 items-center justify-center">
                <span className="absolute h-24 w-24 animate-ping rounded-full bg-white/15" />
                <span className="absolute h-32 w-32 animate-pulse rounded-full border border-white/20" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-2xl">
                  <Play className="h-6 w-6 translate-x-0.5 fill-pink-600 text-pink-600" />
                </div>

                {/* Right action rail */}
                <div className="absolute right-3 flex flex-col items-center gap-4">
                  <RailIcon icon={Heart} label="2.4M" tint="text-pink-300" />
                  <RailIcon icon={MessageCircle} label="18K" />
                  <RailIcon icon={Share2} label="Share" />
                  <div className="flex h-9 w-9 animate-[spin_5s_linear_infinite] items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-black ring-2 ring-white/40">
                    <Music className="h-4 w-4 text-white" />
                  </div>
                </div>
              </div>

              {/* Creator + caption + animated download */}
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-pink-400 to-cyan-300 ring-2 ring-white/60" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">@creator</p>
                    <p className="truncate text-[11px] text-white/70">♪ original sound</p>
                  </div>
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <div className="shimmer h-full w-2/3 rounded-full bg-white" />
                </div>

                <div className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-pink-600 shadow-lg">
                  <Droplet className="h-4 w-4" /> Download HD
                </div>
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
    <div className="flex flex-col items-center gap-0.5 text-white">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/20 backdrop-blur">
        <Icon className={`h-4 w-4 ${tint ?? "text-white"}`} />
      </div>
      <span className="text-[10px] font-medium text-white/90">{label}</span>
    </div>
  );
}
