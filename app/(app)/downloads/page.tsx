import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { DownloadsPage } from "@/features/downloads/downloads-page";
import { DownloadsRail } from "@/features/downloads/downloads-rail";
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
    <AppContent rightRail={<DownloadsRail />}>
      <DownloadsPage />
    </AppContent>
  );
}
