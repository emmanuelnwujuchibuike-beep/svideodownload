import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SubsDashboard } from "@/features/sub/subs-dashboard";
import { subTabFor } from "@/lib/sub/profile";
import { profilePath } from "@/lib/social/profile-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscriptions", robots: { index: false, follow: false } };

/**
 * The creator's Subscriptions dashboard (step 20, design/SubsDashboard.dc.html, owner 2026-10-19) — opened from
 * the Dashboard button on the profile's Exclusive card. Only the creator: the settings are read for the signed-in
 * member themselves. A creator who hasn't set up yet is sent to the setup on their profile.
 */
export default async function SubsDashboardRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/exclusive/dashboard");

  const { data: profile } = await createAdminClient().from("profiles").select("handle, display_name").eq("id", user.id).maybeSingle();
  const handle = (profile?.handle as string | undefined) ?? null;
  const data = await subTabFor(user.id, (profile?.display_name as string | undefined) || handle || "", user.id, true);
  if (!handle || !data?.settings || !data.settings.setupCompleted) redirect(handle ? `${profilePath(handle)}?tab=sub` : "/account");

  return <SubsDashboard creatorId={user.id} handle={handle} settings={data.settings} bounds={data.bounds} />;
}
