import Link from "next/link";

import { Downloader } from "@/features/downloader/downloader";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";

const TILES: { id: PlatformId; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "twitter", label: "X (Twitter)" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "snapchat", label: "Snapchat" },
  { id: "pinterest", label: "Pinterest" },
];

/** Dashboard hero — "Download Anything" with the real paste-and-download widget. */
export function HomeHero() {
  return (
    <section
      id="download"
      className="relative scroll-mt-20 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-violet-700 to-purple-800 p-6 text-white shadow-elevated sm:p-8"
    >
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-fuchsia-400/25 blur-3xl motion-safe:animate-drift" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-blue-400/20 blur-3xl motion-safe:animate-drift-slow" />

      <div className="relative max-w-2xl">
        <h1 className="text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">
          <span className="bg-gradient-to-r from-cyan-300 to-white bg-clip-text text-transparent">Download Anything.</span>
          <br />
          Fast. Secure. <span className="text-cyan-300">Free.</span>
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/80">
          Paste a link from any platform and download videos in seconds. No watermark. No limits.
        </p>

        {/* Real downloader on a light surface for contrast */}
        <div className="mt-5 rounded-2xl bg-background/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur">
          <Downloader />
        </div>

        {/* Supported platforms */}
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-white/70">Supported Platforms</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TILES.map((t) => {
            const platform = PLATFORMS[t.id];
            const Icon = BRAND_ICONS[t.id];
            return (
              <Link
                key={t.id}
                href="#download"
                title={t.label}
                className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${platform.accent} text-white shadow-sm ring-1 ring-white/20 transition hover:scale-110`}
              >
                {Icon ? <Icon className="h-5 w-5" /> : null}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
