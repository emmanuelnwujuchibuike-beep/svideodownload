"use client";

import { getEntry } from "@/features/data";
import { ConversationList } from "@/features/social/conversation-list";
import { INBOX_KEY, type Inbox } from "@/features/social/inbox";
import { InboxListSkeleton } from "@/features/social/inbox-shell";

/**
 * The Suspense fallback for the inbox list — and the last piece of "no flash on
 * back-swipe."
 *
 * `messages/page.tsx` is force-dynamic, so navigating back to it (an iOS PWA
 * edge-swipe = router.back) re-runs the server `InboxList`, which suspends while
 * it re-fetches. The shell (header, stories) already renders instantly from the
 * client, so the ONLY thing that flashed was this list area showing the grey
 * skeleton for the length of that round trip.
 *
 * On a warm re-entry the client inbox cache (INBOX_KEY) is already populated from
 * the last visit — this reads it synchronously and renders the real, last-known
 * conversation list immediately instead of the skeleton. The server then resolves
 * into the SAME <ConversationList> reading the SAME cache, so the swap is
 * invisible: identical rows, no reflow, no flash. `preview` skips that instance's
 * route/message warm-up so it doesn't fire twice.
 *
 * Only a genuine cold start (empty cache — first ever inbox open) falls through to
 * the skeleton, which is correct: there's nothing to show yet.
 */
export function WarmInboxFallback() {
  const cached = getEntry<Inbox>(INBOX_KEY).data;
  if (!cached || cached.conversations.length === 0) return <InboxListSkeleton />;
  return <ConversationList initial={cached.conversations} viewerId="" initialRequests={[]} preview />;
}
