import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FriendsDiscover } from "@/features/friends/discover";
import { peopleYouMayKnow } from "@/lib/social/people/engine";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add friends",
  robots: { index: false, follow: false },
};

/** /friends/discover — full-page "Add friends" (design/friends, 2026-10-26): the suggestion deck, search, contacts/invite and a live
 *  grid of people you may know. Suggestions are server-rendered so it opens
 *  instantly (no spinner-on-open like the old sheet). */
export default async function DiscoverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/discover");

  // In parallel: the handle only feeds the QR-card link, so a miss just hides it.
  const [suggestions, handle] = await Promise.all([
    // Feature 19 Part 6: the one People You May Know engine, every person with a reason
    peopleYouMayKnow(user.id, { limit: 24, userClient: supabase }),
    supabase
      .from("profiles")
      .select("handle")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => (data?.handle as string | undefined) ?? null, () => null),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3"
      style={{ paddingBottom: "calc(var(--frenz-nav-clearance) + 1.5rem)" }}>
      <FriendsDiscover initialSuggestions={suggestions} handle={handle} />
    </div>
  );
}
