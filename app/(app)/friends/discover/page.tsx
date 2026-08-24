import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FriendsDiscover } from "@/features/friends/discover";
import { getSuggestedCreators } from "@/lib/social/suggest";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add friends",
  robots: { index: false, follow: false },
};

/** /friends/discover — full-page "Add friends": search anyone's profile + a live
 *  grid of people you may know. Suggestions are server-rendered so it opens
 *  instantly (no spinner-on-open like the old sheet). */
export default async function DiscoverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/discover");

  const suggestions = await getSuggestedCreators(user.id, 24);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4"
      style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      {/* Matches /explore's heading treatment so the two discovery surfaces
          read as one product: a heavier, tighter-tracked title with the
          subtitle pulled up against it, and the same small accent mark. */}
      <header className="mb-3.5 px-1">
        <h1 className="flex items-center gap-1.5 text-[clamp(1.75rem,7.5vw,2.25rem)] font-extrabold leading-none tracking-[-0.04em]">
          Add friends
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden />
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">Search for anyone, or follow someone new below.</p>
      </header>
      <FriendsDiscover initialSuggestions={suggestions} />
    </div>
  );
}
