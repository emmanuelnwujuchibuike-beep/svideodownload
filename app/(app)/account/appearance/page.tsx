import { Palette } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsPage } from "@/features/account/settings-page";
import { SettingsGroup, SettingsRow } from "@/features/account/settings-ui";
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
    <SettingsPage title="Appearance" description="Theme, and how your home & feed are laid out." bare>
      <SettingsGroup label="THEME">
        <SettingsRow icon={Palette} tint="violet" title="Theme" description="Choose how Frenz looks on this device." right={<ThemeToggle size="sm" />} />
      </SettingsGroup>
      <SettingsGroup label="LANGUAGE">
        <LanguageSettingRow className="rounded-none px-4 py-3.5 hover:bg-secondary/40" />
      </SettingsGroup>
      <SettingsGroup label="HOME & FEED">
        <HomeModulesEditor preferences={homePrefs} />
      </SettingsGroup>
    </SettingsPage>
  );
}
