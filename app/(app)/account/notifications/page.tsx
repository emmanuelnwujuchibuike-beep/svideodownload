import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { NotificationSettingsEditor } from "@/features/account/notification-settings-editor";
import { getNotificationSettings } from "@/lib/social/notification-settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const notificationSettings = await getNotificationSettings(user.id);

  return (
    <SettingsPage title="Notifications" description="Choose what you're alerted about, and how.">
      <NotificationSettingsEditor initial={notificationSettings} />
    </SettingsPage>
  );
}
