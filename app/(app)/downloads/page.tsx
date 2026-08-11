import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { DownloadsPage } from "@/features/downloads/downloads-page";
import { DownloadsSkeleton } from "@/features/downloads/downloads-skeleton";
import { getHomeProfile } from "@/lib/social/home";
import { getLandingSettings } from "@/lib/landing/settings";
import { getPlatformStatus } from "@/lib/platform-status-store";
import { listWallpapers } from "@/lib/wallpapers-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/*
  🔴 THE TOP BAR AND SAFE AREA STAY WHITE — deliberately NOT the canvas (owner,
  2026-08-11: "let the download page top header and safe area be white").

  This was briefly built the other way: the bar was retinted to `--frenz-canvas`
  and this route overrode `theme-color` to #EEF0FA so the PWA status strip
  matched it. Both are reverted, and neither should be reintroduced as a
  "consistency" fix — a white bar over a tinted body is the intended
  relationship here, the same way an iOS navigation bar sits above a grouped
  list rather than dissolving into it.

  So the root layout's white `theme-color` is exactly right for this page and
  needs no per-route override, and `AppTopbar` keeps its default `bg-background`.
  The body below it is still the canvas — see `<AppContent canvas>`.
*/

export const metadata: Metadata = {
  title: "Downloads",
  robots: { index: false, follow: false },
};

/*
  🔴 THE SKELETON NEVER RENDERED, AND THIS IS WHY (owner, 2026-08-10: "i didnt
  see any skeleton loading, i was expecting to see the top header and stripe
  loading on the cold entry of the pwa").

  Adding a shaped `loading.tsx` was necessary and, on its own, useless — because
  of how `loading.tsx` actually works.

  It is a SUSPENSE FALLBACK. Next can only show it if there is something to
  suspend ON. This page component was `async` and did all of its awaiting at the
  TOP LEVEL, so on a cold document request Next had nothing to flush: it held the
  entire HTML response until `auth.getUser()` and three DB reads had finished,
  then sent the finished page. The fallback was never reached, and the visitor
  stared at an empty white document for the whole of it. That is the white screen
  being reported, and it is why `loading.tsx` appeared to do nothing.

  The fix is structural, not cosmetic. This component is now SYNCHRONOUS: it
  returns the shell immediately, so the first bytes — document, CSS, app chrome
  and the skeleton — flush to the browser at once. Every await moves into the
  `<Suspense>`'d child below, which streams in behind it.

  The redirects move with it. A `redirect()` inside a streaming boundary is
  emitted once the boundary resolves rather than before the response starts,
  which is a real and accepted trade: a signed-out visitor now sees the skeleton
  for the instant before being sent to /login, instead of a white screen for the
  same instant. Nothing about the auth DECISION changes — it is still server-side
  and still gates every byte of real content.
*/
export default function Downloads() {
  return (
    /* `canvas` — the native-app ground, shared with the landing page (owner,
       2026-08-11). It is on the SYNCHRONOUS shell rather than inside the
       boundary below, so the tint is in the very first bytes and the skeleton
       already paints on it; putting it on the streamed child would mean a white
       flash for exactly as long as the data takes. */
    <AppContent canvas>
      <Suspense fallback={<DownloadsSkeleton />}>
        <DownloadsData />
      </Suspense>
    </AppContent>
  );
}

async function DownloadsData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/downloads");

  const [profile, wallpapers, landing, platformStatus] = await Promise.all([
    getHomeProfile(user.id),
    listWallpapers(user.id),
    // The admin-uploaded tile background (admin → Landing page). Resolved HERE
    // because DownloadsPage is a client component and cannot read the DB itself.
    getLandingSettings(),
    // Same reason: the supported-platforms strip lives inside a client
    // component, so its status has to arrive as a prop from this boundary.
    getPlatformStatus(),
  ]);
  if (!profile?.handle) redirect("/welcome");

  return (
    /*
      No `rightRail`. The panels used to be passed here and were `hidden xl:flex`,
      so below 1280px — every phone, most tablets — Storage, Quick Actions,
      Categories and Learn did not render at all. They now live INSIDE
      DownloadsPage, in a grid that stacks on small screens and becomes a sticky
      sidebar at `xl`, which is one tree rather than two behind media queries.
    */
    /* `AppContent` is on the synchronous shell above, so it flushes with the
       skeleton rather than waiting for this data. */
    <DownloadsPage
      wallpapers={wallpapers}
      ctaWallpaperUrl={landing.wallpaperCtaImageUrl || null}
      platformStatus={platformStatus}
    />
  );
}
