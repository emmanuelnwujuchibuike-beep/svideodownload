import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/ui/reveal";
import {
  BRAND_ICONS,
  FLAGSHIP_IDS,
  FLAGSHIP_TAGLINES,
} from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getPrimaryPageForPlatform } from "@/lib/seo/seo-pages";

export function FlagshipPlatforms() {
  return (
    <section id="flagship" className="relative overflow-hidden border-t border-border/60 py-28 sm:py-36">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            Flagship platforms
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.75rem] sm:leading-[1.1]">
            Built for the platforms
            <br className="hidden sm:block" /> you use most
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
            First-class, watermark-free downloads for today&apos;s biggest
            social platforms — in HD.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FLAGSHIP_IDS.map((id, i) => {
            const platform = PLATFORMS[id];
            const Icon = BRAND_ICONS[id];
            const href = `/${getPrimaryPageForPlatform(id)?.slug ?? ""}`;
            return (
              <Reveal key={id} delay={(i % 3) * 0.07}>
                <Link
                  href={href}
                  className="group relative block h-full overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-foreground/20 hover:shadow-elevated"
                >
                  {/* Brand glow */}
                  <div
                    className={`pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br ${platform.accent} opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40`}
                  />

                  <div
                    className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accent} text-white shadow-lg ring-1 ring-white/20 transition-transform duration-300 group-hover:scale-105`}
                  >
                    {Icon ? <Icon className="h-7 w-7" /> : null}
                  </div>

                  <h3 className="mt-6 text-xl font-semibold tracking-tight">
                    {platform.name}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {FLAGSHIP_TAGLINES[id]}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-500 ring-1 ring-inset ring-green-500/20">
                      <CheckCircle2 className="h-3 w-3" /> No watermark
                    </span>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      MP4 · HD · MP3
                    </span>
                  </div>

                  <div className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-foreground/70 transition-colors group-hover:text-primary">
                    Download {platform.name.split(" ")[0]}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
