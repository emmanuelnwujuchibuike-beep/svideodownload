import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { ProfileTypePicker } from "@/features/profile/profile-type-picker";
import { getProfileIdentity } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile type", robots: { index: false, follow: false } };

/**
 * Identity Switching™ — one identity, many purposes (Feature 18 · Part 14).
 */
export default async function ProfileTypePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const identity = await getProfileIdentity(user.id);

  return (
    <SettingsPage
      title="Profile type"
      description="What this profile is for. One identity — the sections adapt."
      bare
    >
      <ProfileTypePicker current={identity.type} />
    </SettingsPage>
  );
}
