import type { Metadata } from "next";
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
      <header className="mb-4 px-1">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Exclusive</h1>
        <p className="text-[13.5px] text-muted-foreground">Posts from creators you subscribe to.</p>
      </header>
      <ExclusiveFeed />
    </div>
  );
}
