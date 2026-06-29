import { Sparkles } from "lucide-react";

import { Downloader } from "@/features/downloader/downloader";

/** Slim, noticeable download bar pinned to the top of the dashboard. */
export function HomeHero() {
  return (
    <section
      id="download"
      className="relative scroll-mt-20 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-violet-700 to-purple-800 p-3 shadow-md sm:p-4"
    >
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-fuchsia-400/25 blur-2xl motion-safe:animate-drift" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center gap-2 px-1 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
            <Sparkles className="h-4 w-4 text-cyan-200" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">Download Anything</p>
            <p className="text-[11px] text-white/70">Fast · Secure · No watermark</p>
          </div>
        </div>
        <div className="min-w-0 flex-1 rounded-xl bg-background/95 p-1.5 shadow ring-1 ring-black/5">
          <Downloader />
        </div>
      </div>
    </section>
  );
}
