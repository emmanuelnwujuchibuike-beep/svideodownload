import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FriendsHub } from "@/features/friends/friends-hub";
import { FriendsStories } from "@/features/friends/friends-stories";
import { NearbyDiscovery } from "@/features/friends/nearby-discovery";
import { getDiscoveryFeed } from "@/lib/social/discovery";
import { friendsOverview, runFriendRemindersSoon } from "@/lib/social/friends";
import { getActiveStories } from "@/lib/social/stories";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Friends",
  robots: { index: false, follow: false },
};

/** /friends — Frenz Connect hub: stories (friends/following) on top, requests +
 *  your friends in the middle, and a nearby discovery grid at the bottom. */
export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends");

  // Same opportunistic reminder tick as the API — page loads count too.
  runFriendRemindersSoon();

  // Viewer location drives "near you" ordering (best-effort — column may be unmigrated).
  let viewerLocation: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("profiles").select("location").eq("id", user.id).maybeSingle();
    viewerLocation = (data?.location as string) ?? null;
  } catch {
    /* location column not migrated yet */
  }

  const [overview, friendStories, followingStories, discovery] = await Promise.all([
    friendsOverview(user.id),
    getActiveStories(user.id, 24, "friends"),
    getActiveStories(user.id, 24, "following"),
    getDiscoveryFeed(user.id, { viewerLocation }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <div className="mx-auto w-full max-w-2xl">
          <FriendsStories
            initialFriends={friendStories}
            initialFollowing={followingStories}
            viewerAvatarUrl={overview.viewer?.avatarUrl}
            viewerName={overview.viewer?.displayName}
            viewerHandle={overview.viewer?.handle}
          />
        </div>
        <FriendsHub initial={overview} />
        <div className="mx-auto w-full max-w-2xl">
          <NearbyDiscovery items={discovery.items} nextOffset={discovery.nextOffset} />
        </div>
      </main>
    </div>
  );
}
