import type { Metadata } from "next";
import { Suspense } from "react";

import { FeedTabLinks } from "@/features/feed/feed-topbar-tabs";
import { ExclusiveFeed, FeedSkeleton } from "@/features/sub/exclusive-feed";
import { exclusiveFeed, publicExclusiveFeed } from "@/lib/sub/feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exclusive", robots: { index: false, follow: false } };

/**
 * /exclusive — the Exclusive feed (Frenz Exclusive Part 3): posts from the creators the viewer
 * subscribes to, and locked previews to discover. Access is decided on the server per request
 * (lib/sub/feed.ts).
 *
 * 🔴 OPEN TO SIGNED-OUT VISITORS (owner, 2026-10-22: "make anonymous users able to see the exclusive
 * feed, not the contents, through the exclusive feed button on the landing page"). They get the
 * public page — locked cards only, never a file — and every interaction asks them to sign in
 * (ExclusiveFeed `guest`). This used to redirect them to /login.
 *
 * Part 15: the FIRST page is rendered here, for this viewer, by the same function /api/sub/feed
 * runs — streamed in behind the header (Suspense), so there is no client round trip before the
 * first card. The page is dynamic and per-user (never a shared or public cache); later pages,
 * and any re-check, still go through /api/sub/feed. A failed first page falls back to the
 * client fetching it, exactly as before.
 */
export default async function ExclusiveRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <div className="w-full flex-1 bg-frenz-page">
      <div className="mx-auto w-full max-w-xl flex-1 px-3 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
        {/* design/ExclusiveFeed.dc.html (2026-10-18): Exclusive is the Feed's fourth tab — the same row, this one active */}
        <h1 className="sr-only">Exclusive</h1>
        <FeedTabLinks />
        <Suspense fallback={<FeedSkeleton />}>
          {user ? <FirstPage viewerId={user.id} /> : <GuestPage />}
        </Suspense>
      </div>
    </div>
  );
}

async function GuestPage() {
  return <ExclusiveFeed initial={await publicExclusiveFeed()} guest />;
}

async function FirstPage({ viewerId }: { viewerId: string }) {
  const out = await exclusiveFeed(viewerId, null).catch(() => null);
  if (!out?.ok) return <ExclusiveFeed />;
  const { ok: _ok, ...page } = out;
  return <ExclusiveFeed initial={page} />;
}
