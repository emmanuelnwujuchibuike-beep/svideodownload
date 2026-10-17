import { Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExclusiveFeed, FeedSkeleton } from "@/features/sub/exclusive-feed";
import { exclusiveFeed } from "@/lib/sub/feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exclusive", robots: { index: false, follow: false } };

/**
 * /exclusive — the Exclusive feed (Frenz Exclusive Part 3): posts from the creators the viewer
 * subscribes to, and locked previews to discover. Signed-in only; access is decided on the
 * server per request (lib/sub/feed.ts).
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
  if (!user) redirect("/login?next=/exclusive");
  return (
    <div className="ex-ground w-full flex-1">
      <div className="mx-auto w-full max-w-xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
        <header className="mb-4 flex items-start justify-between gap-3 px-1">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Exclusive</h1>
            <p className="text-[13.5px] text-muted-foreground">Posts from creators you subscribe to.</p>
          </div>
          <Link href="/exclusive/favourites" prefetch={false} className="ex-btn ex-btn--glass ex-btn--sm shrink-0">
            <Star className="h-4 w-4" aria-hidden /> Favourites
          </Link>
        </header>
        <Suspense fallback={<FeedSkeleton />}>
          <FirstPage viewerId={user.id} />
        </Suspense>
      </div>
    </div>
  );
}

async function FirstPage({ viewerId }: { viewerId: string }) {
  const out = await exclusiveFeed(viewerId, null).catch(() => null);
  if (!out?.ok) return <ExclusiveFeed />;
  const { ok: _ok, ...page } = out;
  return <ExclusiveFeed initial={page} />;
}
