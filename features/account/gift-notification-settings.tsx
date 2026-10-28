"use client";

import { PushEmailSwitches } from "@/features/account/push-email-switches";

/**
 * Frenz Gift Coin Part 4.1 (0294): "Sticker gifts" — two switches, push and email, each saved on its own (see
 * PushEmailSwitches). The gift message is in the chat and the earnings in the wallet whatever these say.
 */
export function GiftNotificationSettings({ initial }: { initial: { push: boolean; email: boolean; ready: boolean } }) {
  return (
    <PushEmailSwitches
      id="gift"
      title="Sticker gifts"
      blurb="When someone sends you a sticker gift. The gift always appears in your chat."
      initial={initial}
      keys={{ push: "giftPush", email: "giftEmail" }}
      labels={{
        push: { title: "Gift push notifications", desc: "An alert on your devices. Your notification, push and quiet-hours settings still apply." },
        email: { title: "Gift emails", desc: "An email to your account address. Turning off optional emails turns these off too." },
      }}
    />
  );
}
