import { Droplet, Gauge, Smartphone, Sparkles, MousePointerClick } from "lucide-react";

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
        <div>
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
        </div>

        <div className="relative mx-auto w-full max-w-sm">
          <div className="glass aspect-[9/16] rounded-[2rem] p-3 shadow-2xl">
            <div className="flex h-full flex-col justify-between rounded-[1.5rem] bg-gradient-to-b from-pink-500/30 via-fuchsia-500/20 to-cyan-400/20 p-5">
              <div className="flex items-center justify-between text-xs text-white/80">
                <span>TikTok</span>
                <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-green-300">
                  No watermark
                </span>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-3/4 rounded-full bg-white/30" />
                <div className="h-3 w-1/2 rounded-full bg-white/20" />
                <div className="mt-4 h-11 rounded-xl bg-white/90 text-center text-sm font-semibold leading-[2.75rem] text-pink-600">
                  Download HD
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
