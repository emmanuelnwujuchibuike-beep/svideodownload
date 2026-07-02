import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FriendsHub } from "@/features/friends/friends-hub";
import { friendsOverview, runFriendRemindersSoon } from "@/lib/social/friends";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Friends",
  robots: { index: false, follow: false },
};

/** /friends — Frenz Connect hub: requests (with notes) + your friends. */
export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends");

  // Same opportunistic reminder tick as the API — page loads count too.
  runFriendRemindersSoon();

  const overview = await friendsOverview(user.id);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">
        <FriendsHub initial={overview} />
      </main>
    </div>
  );
}
