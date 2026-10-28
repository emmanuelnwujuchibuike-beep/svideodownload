"use client";

import { PushEmailSwitches } from "@/features/account/push-email-switches";

/**
 * 0295: "Message requests" — push and email, each on its own, for a first message from someone the member doesn't
 * follow and isn't friends with. Only the request is announced, never the message (lib/social/message-request.ts).
 */
export function MessageRequestSettings({ initial }: { initial: { push: boolean; email: boolean; ready: boolean } }) {
  return (
    <PushEmailSwitches
      id="msgreq"
      title="Message requests"
      blurb="When someone you don't follow and aren't friends with messages you. You're told who wants to talk — never what they wrote."
      initial={initial}
      keys={{ push: "messageRequestPush", email: "messageRequestEmail" }}
      labels={{
        push: { title: "Request push notifications", desc: "An alert on your devices, once per new chat. Your notification, push and quiet-hours settings still apply." },
        email: { title: "Request emails", desc: "An email to your account address, once per new chat. Turning off optional emails turns these off too." },
      }}
    />
  );
}
