import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { NotificationControlCenter } from "@/features/account/notification-control-center";
import { NotificationSettingsEditor } from "@/features/account/notification-settings-editor";
import { OptionalEmailSetting } from "@/features/account/optional-email-setting";
import { PushDevices } from "@/features/notifications/push-devices";
import { getOptionalEmailSetting } from "@/lib/email/consent";
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

  const [notificationSettings, optionalEmail] = await Promise.all([getNotificationSettings(user.id), getOptionalEmailSetting(user.id)]);

  return (
    <SettingsPage title="Notifications" description="Choose what you're alerted about, and how.">
      <NotificationSettingsEditor initial={notificationSettings} />
      {/* Part 11 — optional email, one switch above every per-creator email choice */}
      <OptionalEmailSetting initial={optionalEmail} />
      {/* Feature 20 Part 5 — Delivery Rules, suggestions, profiles, backup (saves tap by tap) */}
      <NotificationControlCenter initialRules={notificationSettings.rules} />
      {/* Feature 20 Part 6 — where pushes land, and how the last one went */}
      <PushDevices />
    </SettingsPage>
  );
}
