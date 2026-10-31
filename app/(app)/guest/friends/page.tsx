import type { Metadata } from "next";

import { FriendsHub } from "@/features/friends/friends-hub";
import { GuestLock } from "@/features/social/guest-chat";

/*
  🔴 STATIC (owner, 2026-10-31: "the sign out chat and friends page from the bottom NAV feels not to be statics, they
  load the stripe loader … since nothing is server[ed] on the page"). A signed-out visitor's /friends is the hub, empty
  and locked — nothing private, nothing per-visitor — so it is built once and served from the edge. middleware.ts
  rewrites /friends here when there is no session cookie (a cookie check, no network); the address stays /friends, and
  the nav warms it after the page has loaded, so the tap opens it at once. A signed-in member never reaches this page.
*/
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Friends",
  robots: { index: false, follow: false },
};

export default function GuestFriendsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-[calc(var(--frenz-nav-clearance)+1.5rem)] pt-4 lg:pb-6">
        <GuestLock next="/friends">
          <FriendsHub initial={{ viewer: null, friends: [], incoming: [], outgoing: [], activity: [] }} />
        </GuestLock>
      </main>
    </div>
  );
}
