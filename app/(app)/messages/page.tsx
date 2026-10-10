import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InboxShell } from "@/features/social/inbox-shell";
import { InstantInbox } from "@/features/social/instant-inbox";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * /messages index. Mobile: the full-screen inbox. Desktop: the inbox lives in
 * the layout's left pane, so this route shows an elegant empty-thread panel.
 *
 * IMPORTANT — this page is SYNCHRONOUS on purpose. It's the same fix the LAYOUT
 * already carries one level up (see MessagesLayout's note), applied to the page
 * that was still doing exactly what that comment warns about.
 *
 * Owner report (2026-07-16): "the message page still reloads too noticeable …
 * the message pages should never reload visibly when swiped back, instead it
 * should silently revalidate … no object including the profile button at the
 * top of the message page should never reload."
 *
 * That was right, and this was the cause. The page used to be `async` and
 * `await` the auth check + `listConversations` + `listIncomingFriendRequests`
 * before returning ANY JSX. An async page component suspends, so Next swaps the
 * WHOLE route for `loading.tsx` — the title, the subtitle and the header's
 * action circles (the "profile button at the top") included, even though none
 * of them depend on that data. Every re-render of this route therefore looked
 * like a full page reload rather than a refresh of the list.
 *
 * Now the shell renders in the first pass and only the LIST streams behind its
 * own <Suspense>; `loading.tsx` renders the SAME shell, so there is no visible
 * swap between the two states at all. `ConversationList` is seeded from the
 * shared client cache (features/data), so a warm re-entry paints the last-known
 * conversations immediately and revalidates silently in the background — the
 * "silently revalidate for current data and messages" half of the ask.
 *
 * 🔴 2026-10-10 — THE LIST NO LONGER WAITS FOR THE SERVER AT ALL (owner: "the
 * avatar and nothing in the message page should ever load on first or every
 * entry, it should open instant"). The streamed list above still awaited auth +
 * every conversation + the friend requests on each entry and each iOS relaunch,
 * with the stripe loader up until they returned. Now <InstantInbox> paints from
 * memory or from this account's saved copy on the device and refreshes through
 * /api/messages behind it; the loader shows only on a device that has never
 * seen this inbox. Signed-out visitors are sent to /login by InstantInbox, and
 * the data endpoint answers nothing without a session.
 */
export default function MessagesPage() {
  if (!hasSupabase) redirect("/login");

  return (
    <InboxShell>
      <InstantInbox />
    </InboxShell>
  );
}
