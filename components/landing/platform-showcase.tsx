import { MoreHorizontal } from "lucide-react";
import Link from "next/link";

import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/types";

// Display order + short labels to match the marketing grid.
const TILES: { id: PlatformId; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "twitter", label: "X (Twitter)" },
  { id: "youtube", label: "YouTube Shorts" },
  { id: "snapchat", label: "Snapchat" },
  { id: "pinterest", label: "Pinterest" },
  { id: "reddit", label: "Reddit" },
  { id: "threads", label: "Threads" },
];

export function PlatformShowcase() {
  return (
    <section id="platforms" className="container max-w-6xl py-10 sm:py-14">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Download from 20+ Platforms</h2>
        <p className="mt-2 text-sm text-muted-foreground">Supports all your favorite platforms and more.</p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
        {TILES.map((t) => {
          const platform = PLATFORMS[t.id];
          const Icon = BRAND_ICONS[t.id];
          return (
            <Link
              key={t.id}
              href="/#download"
              className="group flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-4 shadow-soft transition hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${platform.accent} text-white shadow-sm transition-transform duration-300 group-hover:scale-110`}>
                {Icon ? <Icon className="h-5 w-5" /> : null}
              </span>
              <span className="text-center text-[11px] font-medium leading-tight">{t.label}</span>
            </Link>
          );
        })}
        {/* More */}
        <Link
          href="/#download"
          className="group flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-4 shadow-soft transition hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-transform duration-300 group-hover:scale-110">
            <MoreHorizontal className="h-5 w-5" />
          </span>
          <span className="text-center text-[11px] font-medium leading-tight">More</span>
        </Link>
      </div>
    </section>
  );
}
