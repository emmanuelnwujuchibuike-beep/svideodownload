import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HistoryCompleteAd } from "@/features/history/history-complete-ad";
import { HistoryPanel } from "@/features/history/history-panel";
import { DownloadHistoryAd } from "@/features/monetization/download-history-ad";
import { ReviewPlayerMount } from "@/features/downloads/review-player-mount";

/**
 * `/history` — the shared, history-ONLY page (owner: "a shared history that shows
 * only the history section in a different history page"). It renders just the
 * download history gallery (grid/list, columns, sort) — no paste box, no usage
 * dashboard — for both signed-in and signed-out visitors (read from localStorage
 * on the client, so the page is static and opens instantly). It's the "History"
 * destination in both the Downloader and Full-Bleed bottom navs.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Your history",
  description: "Everything you've downloaded, in one place.",
  robots: { index: false, follow: false },
};

export default function HistoryPage() {
  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      {/* Just clears the fixed header — the big gap was too much top padding here
          stacking with the panel's own (owner). */}
      <main className="pb-24 pt-[calc(var(--frenz-safe-top)+4.75rem)]">
        {/*
          🔴 The download-history ad zones, which this page never rendered
          (owner, 2026-08-09: "I no longer see ad even after I turn on the ad").

          Nothing was covering them — they were not on the page at all. Verified
          against the live `/api/ads` rather than guessed:

            download_history_top     → seeded
            download_history_bottom  → seeded
            top_banner               → empty
            bottom_banner            → empty

          The only ad furniture /history carried came from the marketing layout,
          and both of those zones are unseeded — so the operator filled the two
          zones named after this page and saw nothing, while the page quietly
          asked for two different zones that were empty. /library and /downloads
          both render these; this page was the one that did not, which is also
          why the ad "disappeared" when History became its own destination.
        */}
        <HistoryPanel
          standalone
          /* Above the GRID, under the search and filter chips (owner, with a
             screenshot). Placed at the top of the page it sat above the panel's
             whole header, which is not where it was asked for. */
          beforeGrid={<DownloadHistoryAd position="top" maxWidth="max-w-3xl" />}
        />
        <div className="mx-auto mt-6 max-w-6xl px-2 sm:px-4">
          <DownloadHistoryAd position="bottom" maxWidth="max-w-3xl" />
        </div>
        {/*
          🔴 THE AFTER-DOWNLOAD AD, ON THIS PAGE TOO (owner, 2026-08-24: "all
          Downloads must trigger the Download complete ad").

          Retrying from history starts a real transfer, but this route never
          mounted the completion ad — /downloads and the landing page get it
          via DownloadPageCore/download-box, and this page renders neither. So
          a retry was the one download that finished with no ad at all.

          It subscribes to the manager's own completion beat and renders
          nothing until a transfer actually finishes, so mounting it costs a
          subscription and no markup.
        */}
        <HistoryCompleteAd />
      </main>
      {/* Mounts the story-style review player so tapping a tile opens INSTANTLY on
          this page (owner) — without this, /history has no Downloader mounting it,
          so a tap only opened once you navigated to a page that did. Renders null
          until something is queued. */}
      <ReviewPlayerMount />
      <SiteFooter />
    </div>
  );
}
