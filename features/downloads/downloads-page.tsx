"use client";

import type { AiPromo } from "@/lib/ai/promo/config";
import { useEffect, useMemo, useState } from "react";

import { AppBand, CreatorBand } from "@/components/landing/creator-app-bands";
import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { DownloadBox } from "@/features/downloads/download-box";
import { HomeHero, HomeTools, LiveDownloads, StorageRow } from "@/features/downloads/home-screen";
import { MultiLinkButton } from "@/features/downloader/multi-link/multi-link-button";
import { Card } from "@/features/frenz-ui/primitives";
import { useHistory } from "@/features/history/use-history";
import { AdSurface } from "@/features/monetization/ad-surface";
import { DownloadHistoryAd } from "@/features/monetization/download-history-ad";
import { DownloadInterstitial } from "@/features/monetization/download-interstitial";
import { ExitIntent } from "@/features/monetization/exit-intent";
import { TiredOfAds } from "@/features/monetization/tired-of-ads";
import type { MultiLinkPublicConfig } from "@/lib/downloads/multi-link-config";
import type { PlatformStatusMap } from "@/lib/platform-status";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * /downloads — the member's Home tab, rebuilt to design/Main.dc.html (2026-10-18).
 *
 * The page the design draws, top to bottom: the hero (the existing H1 and its line, owner), the
 * paste card, Batch download, the transfers in flight, Tools (Frenz AI, Wallpapers, Earn,
 * Exclusive, Explore — where Recent was; Recent lives in History now, owner), Cloud storage.
 *
 * Kept from the old page because they are revenue or legal, not layout: the three ad zones
 * (each collapses when unfilled), "Tired of ads", the download interstitial, exit intent and the
 * trademark disclaimer. Gone, for the owner's "everything must be light weight": the stat tiles,
 * quick actions, the side rail, the trust strip and the in-page wallpaper gallery (Wallpapers is
 * one tap away) — and with the gallery, the 600-row wallpaper read on every visit.
 */
export function DownloadsPage({
  wallpapers,
  platformStatus,
  multiLink,
  aiPromo = null,
}: {
  /** Up to 10 wallpapers for the showcase card, or a promise of them (streamed, never awaited). */
  wallpapers: Wallpaper[] | Promise<Wallpaper[]>;
  platformStatus?: PlatformStatusMap;
  multiLink?: MultiLinkPublicConfig;
  /** The Frenz AI promotion played over the Frenz AI card. */
  aiPromo?: AiPromo | null;
}) {
  const { items } = useHistory();

  // The server streams the wallpapers as a promise so nothing above waits for them;
  // until they land the Wallpapers card shows its own gradient.
  const [walls, setWalls] = useState<Wallpaper[] | null>(() => (Array.isArray(wallpapers) ? wallpapers : null));
  useEffect(() => {
    if (Array.isArray(wallpapers)) {
      setWalls(wallpapers);
      return;
    }
    let alive = true;
    wallpapers.then(
      (list) => alive && setWalls(list),
      () => alive && setWalls([]),
    );
    return () => {
      alive = false;
    };
  }, [wallpapers]);
  const rotateUrls = useMemo(() => (walls ?? []).slice(0, 10).map((w) => w.url).filter(Boolean), [walls]);

  return (
    <div className="frenz-ui mx-auto max-w-2xl px-1 text-frenz-ink">
      <HomeHero />

      <Card as="section" raised id="download" aria-label="Download a link" className="mt-5 scroll-mt-20 rounded-[26px] p-3.5">
        <DownloadBox surface="frenz" platformStatus={platformStatus} multiLink={multiLink} />
      </Card>

      <MultiLinkButton config={multiLink} surface="frenz" className="mt-3" />

      <LiveDownloads />

      <HomeTools aiPromo={aiPromo} rotateUrls={rotateUrls} />

      {/* the ad sits UNDER the Frenz AI and Wallpapers cards, as on the landing (owner, 2026-10-19) */}
      <AdSurface zone="under_download" fullBleed className="mt-6" />

      <StorageRow items={items} />

      <DownloadHistoryAd position="top" maxWidth="max-w-3xl" />
      <TiredOfAds />
      <DownloadHistoryAd position="bottom" maxWidth="max-w-3xl" />

      {/* the new design's Creator Lounge and app bands (owner, 2026-10-28); the app band hides once installed */}
      <CreatorBand inPage />
      <AppBand inPage />

      <div className="mt-6">
        <DownloadDisclaimer variant="card" />
      </div>

      {/* Render nothing for premium visitors (see each) — revenue furniture, not layout. */}
      <DownloadInterstitial />
      <ExitIntent />
    </div>
  );
}
