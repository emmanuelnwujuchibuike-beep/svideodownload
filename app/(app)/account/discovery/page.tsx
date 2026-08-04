import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DiscoverySettingsPanel } from "@/features/account/discovery-settings";
import { SettingsPage } from "@/features/account/settings-page";
import { getDiscoverySettings } from "@/lib/social/discovery-settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discovery", robots: { index: false, follow: false } };

/** /account/discovery — who can find you, and by what (Feature 18 · Part 18). */
export default async function DiscoveryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/discovery");

  const settings = await getDiscoverySettings(user.id);

  return (
    <SettingsPage title="Discovery" description="Who can find you, and what they can find you by." bare>
      <DiscoverySettingsPanel initial={settings} />
    </SettingsPage>
  );
}
