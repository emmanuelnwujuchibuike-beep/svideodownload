"use client";

import { Play } from "lucide-react";

import { PendingLink } from "@/features/frenz-ui/pending";
import { openReelInPlace, reelStartId } from "@/features/reels/reel-open-store";
import { VideoCover } from "@/features/search/media";
import { formatCompactNumber } from "@/lib/utils";

/**
 * One video cover tile (Search & Discover design, 2026-10-26): 3:4, rounded, the real view count bottom-left,
 * optional two-line caption under it. Its own file, free of server imports, so the server-rendered Discover
 * grid and the client results view both use it. Nothing autoplays. A plain tap on a video opens the Reels deck IN PLACE
 * (reel-open-store.ts) — no /reels page load; a modified click, or no host yet, follows the link as before.
 */
export type VideoTileData = { href: string; title: string; thumbnailUrl: string | null; mediaUrl: string | null; mediaKind: string; viewsCount: number };

export function VideoTile({ video: v, caption = false, sizes = "(max-width: 640px) 33vw, 200px" }: { video: VideoTileData; caption?: boolean; sizes?: string }) {
  return (
    <PendingLink
      href={v.href}
      prefetch={false}
      aria-label={v.title || "Video"}
      className="block rounded-[18px]"
      inner="block"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const id = reelStartId(v.href);
        if (id && openReelInPlace(id)) e.preventDefault();
      }}
    >
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-[18px] bg-frenz-fill">
        <VideoCover thumbnailUrl={v.thumbnailUrl} mediaUrl={v.mediaUrl} mediaKind={v.mediaKind} sizes={sizes} />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="absolute bottom-2 left-2.5 flex items-center gap-1 text-[13px] font-bold text-white">
          <Play className="h-3 w-3 fill-current" aria-hidden />
          {formatCompactNumber(v.viewsCount)}
        </span>
      </span>
      {caption && v.title ? <span className="mt-1.5 line-clamp-2 text-left text-[14px] font-bold leading-snug text-frenz-ink">{v.title}</span> : null}
    </PendingLink>
  );
}
