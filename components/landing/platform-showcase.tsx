import { CheckCircle2 } from "lucide-react";
import type { IconType } from "react-icons";
import {
  SiBilibili,
  SiDailymotion,
  SiFacebook,
  SiInstagram,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiSoundcloud,
  SiThreads,
  SiTiktok,
  SiTwitch,
  SiVimeo,
  SiVk,
  SiX,
  SiYoutube,
} from "react-icons/si";

import { Reveal } from "@/components/ui/reveal";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";

const BRAND_ICONS: Partial<Record<PlatformId, IconType>> = {
  tiktok: SiTiktok,
  instagram: SiInstagram,
  facebook: SiFacebook,
  twitter: SiX,
  pinterest: SiPinterest,
  reddit: SiReddit,
  vimeo: SiVimeo,
  dailymotion: SiDailymotion,
  twitch: SiTwitch,
  soundcloud: SiSoundcloud,
  youtube: SiYoutube,
  threads: SiThreads,
  snapchat: SiSnapchat,
  bilibili: SiBilibili,
  vk: SiVk,
};

export function PlatformShowcase() {
  return (
    <section id="platforms" className="relative overflow-hidden border-t border-border/60 py-28 sm:py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-[60rem] -translate-x-1/2 bg-gradient-to-r from-pink-500/[0.07] via-fuchsia-500/[0.07] to-cyan-400/[0.07] blur-3xl"
      />
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            Universal support
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.75rem] sm:leading-[1.1]">
            Every platform you use,
            <br className="hidden sm:block" /> one downloader
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
            From short-form video to long-form audio — all through a single,
            unified extraction engine.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {SHOWCASE_PLATFORMS.map((p, i) => {
            const Brand = BRAND_ICONS[p.id];
            return (
            <Reveal key={p.id} delay={(i % 4) * 0.06}>
              <article className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-elevated">
                {/* Soft brand glow on hover */}
                <div
                  className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${p.accent} opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40`}
                />
                {/* Gradient ring on hover */}
                <div
                  className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${p.accent} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
                  style={{
                    WebkitMask:
                      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                    padding: "1px",
                  }}
                />

                <div
                  className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${p.accent} text-base font-bold text-white shadow-lg ring-1 ring-white/20 transition-transform duration-300 group-hover:scale-110`}
                >
                  {Brand ? (
                    <Brand className="h-6 w-6" />
                  ) : (
                    p.name.replace(/[^A-Za-z]/g, "").slice(0, 2)
                  )}
                </div>

                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.audioOnly ? "MP3 · M4A · WAV" : "MP4 · HD · MP3"}
                </p>

                {p.watermarkFree ? (
                  <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">
                    <CheckCircle2 className="h-3 w-3" /> No watermark
                  </span>
                ) : (
                  <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Up to 4K
                  </span>
                )}
              </article>
            </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
