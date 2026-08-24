"use client";

import { Bell } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

/*
  The sheet is code-split and only requested once the bell is actually pressed.
  This button renders on every profile view; the panel behind it is opened by a
  small minority of them, so its chunk has no business in the profile's initial
  JS (see [[feedback-code-split-heavy-header-widgets-off-first-load]]).
*/
const CreatorNotificationsSheet = dynamic(
  () => import("@/features/social/creator-notifications-sheet").then((m) => m.CreatorNotificationsSheet),
  { ssr: false },
);

/**
 * The bell on a profile — opens that person's notification switches.
 *
 * A thin client wrapper so `app/u/[handle]/page.tsx` (a Server Component) can
 * place it in the action row without becoming a client component itself.
 */
export function CreatorNotificationsButton({ userId, handle }: { userId: string; handle: string }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => { setReady(true); setOpen(true); }}
        aria-label={`Notification settings for @${handle}`}
        title="Notifications"
        className="btn-lux btn-lux-secondary shrink-0 justify-center px-3"
      >
        <Bell className="h-4 w-4" />
      </button>
      {ready ? (
        <CreatorNotificationsSheet userId={userId} handle={handle} open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
