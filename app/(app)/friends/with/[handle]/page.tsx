import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { FriendshipPage } from "@/features/friends/friendship-page";
import { loadFriendshipStory } from "@/lib/social/friendship/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your friendship",
  robots: { index: false, follow: false },
};

/** /friends/with/[handle] — Friend Profile™ (Feature 19 · Part 7). Exists only for two people who are friends. */
export default async function FriendshipRoute({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(`/friends/with/${handle}`));
  const story = await loadFriendshipStory(user.id, decodeURIComponent(handle));
  // not friends (or no such person): the page does not exist for this viewer
  if (!story) notFound();
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <FriendshipPage story={story} />
    </div>
  );
}
