import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WelcomeSetup } from "@/features/onboarding/welcome-setup";
import { getOwnProfile } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/welcome");

  const profile = await getOwnProfile(user.id);
  // Already onboarded → straight to the app.
  if (profile?.handle) redirect("/home");

  return (
    <WelcomeSetup
      email={user.email ?? null}
      initialDisplayName={profile?.displayName ?? ""}
      initialAvatarUrl={profile?.avatarUrl ?? null}
    />
  );
}
