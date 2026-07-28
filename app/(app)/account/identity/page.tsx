import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { ProfileEditor } from "@/features/social/profile-editor";
import { getOwnProfile, getProfileExtras, getProfileMedia } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Identity", robots: { index: false, follow: false } };

export default async function IdentitySettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [ownProfile, extras, media] = await Promise.all([
    getOwnProfile(user.id),
    getProfileExtras(user.id),
    getProfileMedia(user.id),
  ]);

  return (
    <SettingsPage title="Identity" description="Name, photo, video, avatar, status, accent & links.">
      {ownProfile ? <ProfileEditor profile={ownProfile} extras={extras} media={media} /> : null}
    </SettingsPage>
  );
}
