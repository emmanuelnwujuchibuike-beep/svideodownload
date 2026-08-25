import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DiscoveryControls } from "@/features/account/discovery-controls";
import { SettingsPage } from "@/features/account/settings-page";
import { getFrenzDna } from "@/lib/social/frenz-dna";
import { getHomePreferences } from "@/lib/social/home-preferences";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discovery & personalization", robots: { index: false, follow: false } };

/**
 * /account/personalization — Discovery Controls + Frenz DNA™ (Feature 15
 * Part 8). Separate from /account/discovery (profile FINDABILITY — who can
 * find you, migration 0113) and from /account/appearance's Home & Feed
 * section (layout/module ordering) — this page is specifically about what
 * the discovery/recommendation engine shows you and why.
 */
export default async function PersonalizationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/personalization");

  const [preferences, interests] = await Promise.all([getHomePreferences(user.id), getFrenzDna(user.id)]);

  return (
    <SettingsPage
      title="Discovery & personalization"
      description="What Frenz shows you, why, and how much control you have over it."
      bare
    >
      <DiscoveryControls preferences={preferences} interests={interests} />
    </SettingsPage>
  );
}
