import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { NotificationControlCenter } from "@/features/account/notification-control-center";
import { NotificationSettingsEditor } from "@/features/account/notification-settings-editor";
import { GiftNotificationSettings } from "@/features/account/gift-notification-settings";
import { MessageRequestSettings } from "@/features/account/message-request-settings";
import { OptionalEmailSetting } from "@/features/account/optional-email-setting";
import { PushDevices } from "@/features/notifications/push-devices";
import { getOptionalEmailSetting } from "@/lib/email/consent";
import { getGiftNotifyPrefs } from "@/lib/gift/notify-prefs";
import { getMessageRequestPrefs } from "@/lib/social/message-request";
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

  const [notificationSettings, optionalEmail, giftNotify, messageRequest] = await Promise.all([getNotificationSettings(user.id), getOptionalEmailSetting(user.id), getGiftNotifyPrefs(user.id), getMessageRequestPrefs(user.id)]);

  return (
    <SettingsPage title="Notifications" description="Choose what you're alerted about, and how.">
      <NotificationSettingsEditor initial={notificationSettings} />
      {/* Part 11 — optional email, one switch above every per-creator email choice */}
      <OptionalEmailSetting initial={optionalEmail} />
      {/* Frenz Gift Coin Part 4.1 — sticker gifts: push and email, each on its own */}
      <GiftNotificationSettings initial={giftNotify} />
      {/* 0295 — message requests from people you don't follow: push and email, each on its own, never the message */}
      <MessageRequestSettings initial={messageRequest} />
      {/* Feature 20 Part 5 — Delivery Rules, suggestions, profiles, backup (saves tap by tap) */}
      <NotificationControlCenter initialRules={notificationSettings.rules} />
      {/* Feature 20 Part 6 — where pushes land, and how the last one went */}
      <PushDevices />
    </SettingsPage>
  );
}
