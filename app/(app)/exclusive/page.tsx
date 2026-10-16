import { Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExclusiveFeed } from "@/features/sub/exclusive-feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exclusive", robots: { index: false, follow: false } };

/**
 * /exclusive — the Exclusive feed (Frenz Exclusive Part 3): posts from the creators the viewer
 * subscribes to, and locked previews to discover. Signed-in only; everything the page shows is
 * fetched from /api/sub/feed, which decides access on the server per request.
 */
export default async function ExclusiveRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/exclusive");
  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <header className="mb-4 flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Exclusive</h1>
          <p className="text-[13.5px] text-muted-foreground">Posts from creators you subscribe to.</p>
        </div>
        <Link href="/exclusive/favourites" prefetch={false} className="inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full bg-black/[0.04] px-3.5 text-[13px] font-semibold text-foreground/80 transition hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/[0.07]">
          <Star className="h-4 w-4" aria-hidden /> Favourites
        </Link>
      </header>
      <ExclusiveFeed />
    </div>
  );
}
