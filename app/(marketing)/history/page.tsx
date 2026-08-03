import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HistoryPanel } from "@/features/history/history-panel";
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
        <HistoryPanel standalone />
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
