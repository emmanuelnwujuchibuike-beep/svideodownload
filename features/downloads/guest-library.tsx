"use client";

import { FolderDown, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { Downloader } from "@/features/downloader/downloader";
import { HistoryPanel } from "@/features/history/history-panel";
import { useUser } from "@/features/auth/use-user";
import { UsageDashboard } from "./usage-dashboard";

/**
 * The public download library — the signed-out home for "your downloads".
 *
 * `/downloads` is the full signed-in dashboard and sits behind auth; a guest who
 * tapped "Downloads" used to hit a login wall. This is the guest-reachable
 * counterpart: the paste box to grab another video, the usage analytics + 5 GB
 * quota meter, and the on-device history list — all rendered from localStorage
 * on the client, so the page is served static from the CDN and paints instantly
 * with no data fetch (the "nothing loads" requirement).
 *
 * It works for signed-in visitors too (uncapped, synced), and points them at the
 * richer `/downloads` dashboard rather than duplicating it.
 */
export function GuestLibrary() {
  const { user } = useUser();

  return (
    <div className="container max-w-3xl space-y-8">
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FolderDown className="h-3.5 w-3.5" /> Your downloads
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
          Everything you&apos;ve saved
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
          Paste a link to grab another video, and track your usage below. Your history is stored{" "}
          {user ? "on your account and synced across devices" : "privately on this device"}.
        </p>
      </header>

      {/* Paste box — the "preview & download" affordance, self-contained here so
          a guest never has to leave this page to save another video. */}
      <Downloader />

      {/* Usage analytics + the 5 GB quota meter (or unlimited, when signed in). */}
      <UsageDashboard />

      {/* The on-device history list (search / favourite / re-download / remove).
          Returns nothing until there is at least one saved download. */}
      <HistoryPanel />

      {/* Signed-in visitors get the full dashboard; don't duplicate it here. */}
      {user ? (
        <div className="text-center">
          <Link
            href="/downloads"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold shadow-soft transition hover:bg-secondary"
          >
            <LayoutDashboard className="h-4 w-4" /> Open your full Downloads dashboard
          </Link>
        </div>
      ) : null}
    </div>
  );
}
