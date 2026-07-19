import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { DownloadsPage } from "@/features/downloads/downloads-page";
import { getHomeProfile } from "@/lib/social/home";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Downloads",
  robots: { index: false, follow: false },
};

export default async function Downloads() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/downloads");

  const profile = await getHomeProfile(user.id);
  if (!profile?.handle) redirect("/welcome");

  return (
    /*
      No `rightRail`. The panels used to be passed here and were `hidden xl:flex`,
      so below 1280px — every phone, most tablets — Storage, Quick Actions,
      Categories and Learn did not render at all. They now live INSIDE
      DownloadsPage, in a grid that stacks on small screens and becomes a sticky
      sidebar at `xl`, which is one tree rather than two behind media queries.
    */
    <AppContent>
      <DownloadsPage />
    </AppContent>
  );
}
