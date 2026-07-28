import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsPage } from "@/features/account/settings-page";
import { HomeModulesEditor } from "@/features/account/home-modules-editor";
import { getHomePreferences } from "@/lib/social/home-preferences";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Appearance", robots: { index: false, follow: false } };

export default async function AppearanceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const homePrefs = await getHomePreferences(user.id);

  return (
    <SettingsPage title="Appearance" description="Theme, and how your home & feed are laid out.">
      <div className="border-b border-border/60 p-6 sm:p-8">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Theme</h2>
          <p className="text-xs text-muted-foreground">Choose how Frenz looks on this device.</p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-4">
          <span className="text-sm font-medium">Theme</span>
          <ThemeToggle />
        </div>
      </div>
      <HomeModulesEditor preferences={homePrefs} />
    </SettingsPage>
  );
}
