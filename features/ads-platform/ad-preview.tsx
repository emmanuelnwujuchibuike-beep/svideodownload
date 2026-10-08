"use client";

import { ArrowRight, Gift, X } from "lucide-react";

import type { CatalogFormat } from "@/lib/ads-platform/offer";
import { cn } from "@/lib/utils";

/**
 * A live preview of the advertiser's REAL creative in the format's REAL
 * proportions — no server round trip, ever: the media is the local file (an
 * object URL) or the already-validated public copy.
 *
 * Which frame is shown follows from the format's configuration, not its name:
 *   width × height        → a card at exactly that size, inside a page
 *   height only           → a full-width strip under the header
 *   no size, video only   → the reward-video player
 *   no size               → a full-screen interstitial
 */

export type PreviewKind = "strip" | "card" | "fullscreen" | "reward";

export function previewKind(f: Pick<CatalogFormat, "width" | "height" | "media_types">): PreviewKind {
  if (f.width && f.height) return "card";
  if (f.height) return "strip";
  return f.media_types.length === 1 && f.media_types[0] === "video" ? "reward" : "fullscreen";
}

/**
 * The example shown BEFORE an advertiser has uploaded anything (owner, 2026-10-07:
 * "always show them a preview of how their ad will appear when they choose
 * different ad formats"). Frenz AI is the example brand on purpose: everyone on
 * the site knows it, and it is ours — a real third-party brand in a mock ad
 * would read as that company advertising here, which our own rules forbid.
 * Pre-sized WebP in /public (3–8 kB each).
 */
export const EXAMPLE_AD = {
  sponsor: "Frenz AI",
  headline: "Turn your words into video",
  description: "Create AI videos, voices and images in seconds.",
  host: "frenzsave.com",
} as const;

export function exampleCreative(kind: PreviewKind): PreviewCreative {
  if (kind === "strip") return { src: "/advertise/example-banner.webp", mediaType: "image" };
  if (kind === "card") return { src: "/advertise/example-card.webp", mediaType: "image" };
  return { src: "/advertise/example-portrait.webp", mediaType: "image", durationSeconds: null };
}

export interface PreviewCreative {
  src: string;
  mediaType: "image" | "video";
  poster?: string | null;
  durationSeconds?: number | null;
}

function Media({ c, className }: { c: PreviewCreative; className?: string }) {
  return c.mediaType === "video" ? (
    <video src={c.src} poster={c.poster ?? undefined} className={cn("h-full w-full object-cover", className)} muted loop autoPlay playsInline preload="metadata" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL or a storage URL, shown at its true size
    <img src={c.src} alt="" className={cn("h-full w-full object-cover", className)} />
  );
}

function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block rounded-full bg-slate-200/80", className)} aria-hidden />;
}

/** The phone the preview sits in — a frame, not a device screenshot. */
function Phone({ children, dark, compact }: { children: React.ReactNode; dark?: boolean; compact?: boolean }) {
  return (
    <div className={cn("mx-auto w-full rounded-[2.2rem] bg-slate-900 p-[7px] shadow-[0_24px_60px_-30px_rgba(30,27,75,0.6)]", compact ? "max-w-[200px]" : "max-w-[250px] sm:max-w-[290px]")}>
      <div className={cn("relative aspect-[9/19] overflow-hidden rounded-[1.8rem]", dark ? "bg-black" : "bg-white")}>{children}</div>
    </div>
  );
}

export function AdPreview({
  format,
  creative,
  sponsor,
  headline,
  description,
  host,
  example,
  compact,
}: {
  format: CatalogFormat;
  creative: PreviewCreative | null;
  sponsor: string;
  headline: string;
  description: string;
  host: string | null;
  /** show the Frenz AI example (nothing uploaded yet), and say so */
  example?: boolean;
  compact?: boolean;
}) {
  const kind = previewKind(format);
  if (example) {
    return (
      <div className="relative pt-2">
        <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full bg-slate-900 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-white">Example</span>
        <AdPreview format={format} creative={exampleCreative(kind)} sponsor={EXAMPLE_AD.sponsor} headline={EXAMPLE_AD.headline} description={EXAMPLE_AD.description} host={EXAMPLE_AD.host} compact={compact} />
      </div>
    );
  }
  const label = sponsor || "Your brand";
  const empty = <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-100 to-sky-100 text-[12px] font-semibold text-indigo-500">Your creative</div>;

  if (kind === "strip") {
    return (
      <Phone compact={compact}>
        <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
          <span className="font-brand text-[15px] font-bold tracking-[-0.02em]">Frenzsave</span>
          <Skeleton className="h-6 w-6" />
        </div>
        <div className="relative w-full overflow-hidden" style={{ height: format.height ?? 32 }}>
          {creative ? <Media c={creative} /> : empty}
          <span className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-black/45 px-1 text-[9px] font-semibold text-white">Ad</span>
        </div>
        <div className="space-y-3 p-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </Phone>
    );
  }

  if (kind === "card") {
    const w = format.width ?? 320;
    const h = format.height ?? 200;
    return (
      <Phone compact={compact}>
        <div className="space-y-3 px-3 pt-4">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
        <div className="mx-auto mt-3 overflow-hidden rounded-2xl ring-1 ring-black/[0.06]" style={{ width: "calc(100% - 24px)", maxWidth: w }}>
          <div className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
            {creative ? <Media c={creative} /> : empty}
          </div>
          <div className="flex items-center gap-2 bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-slate-500">Sponsored · {label}</p>
              {headline ? <p className="line-clamp-2 text-[12.5px] font-bold leading-tight">{headline}</p> : null}
              {description ? <p className="line-clamp-1 text-[11px] text-slate-500">{description}</p> : null}
            </div>
            <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[10.5px] font-semibold text-white">Visit</span>
          </div>
        </div>
        <div className="space-y-3 px-3 pt-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </Phone>
    );
  }

  // full-screen: interstitial or reward video
  const reward = kind === "reward";
  const secs = Math.max(1, Math.round(creative?.durationSeconds ?? format.max_duration_seconds ?? 15));
  return (
    <Phone dark compact={compact}>
      {creative ? <Media c={creative} /> : empty}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <span className="rounded-full bg-black/50 px-2.5 py-1 text-[10.5px] font-semibold text-white">
          {reward ? (
            <span className="inline-flex items-center gap-1">
              <Gift className="h-3 w-3" aria-hidden /> Reward in {secs}s
            </span>
          ) : (
            "Ad"
          )}
        </span>
        {!reward ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white" aria-hidden>
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-10 text-white">
        <p className="text-[11px] font-semibold text-white/75">Sponsored · {label}</p>
        {headline ? <p className="mt-0.5 line-clamp-2 text-[14px] font-bold leading-tight">{headline}</p> : null}
        {description ? <p className="mt-0.5 line-clamp-2 text-[11.5px] text-white/80">{description}</p> : null}
        <span className="mt-2 flex items-center justify-center gap-1 rounded-full bg-white py-2 text-[12px] font-bold text-slate-900">
          Visit {host ?? "website"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
        {reward ? <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/25" aria-hidden><span className="block h-full w-1/3 rounded-full bg-white" /></span> : null}
      </div>
    </Phone>
  );
}
