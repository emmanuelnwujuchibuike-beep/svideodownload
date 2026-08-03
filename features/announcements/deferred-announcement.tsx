"use client";

import dynamic from "next/dynamic";

/**
 * Code-splits the announcement bar off the app shell's first-load bundle. A plain
 * static import of AnnouncementBanner in the (app) layout put it into a chunk the
 * landing page also loads (shared vendor chunk), so growing the banner grew the
 * landing's cold-entry weight and broke the 302 kB budget. Loading it via a client
 * `dynamic()` wrapper keeps its code in an async chunk on both sides.
 */
const AnnouncementBanner = dynamic(
  () => import("./announcement-banner").then((m) => m.AnnouncementBanner),
  { ssr: false },
);

export function DeferredAnnouncement({ showOn }: { showOn?: string[] }) {
  return <AnnouncementBanner showOn={showOn} />;
}
