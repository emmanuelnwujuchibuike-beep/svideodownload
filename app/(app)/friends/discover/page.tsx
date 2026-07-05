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
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pb-24 pt-4 sm:px-4 lg:pb-6">
      <h1 className="mb-1 px-1 text-2xl font-extrabold tracking-tight">Add friends</h1>
      <p className="mb-3 px-1 text-sm text-muted-foreground">Search for anyone, or follow someone new below.</p>
      <FriendsDiscover initialSuggestions={suggestions} />
    </div>
  );
}
