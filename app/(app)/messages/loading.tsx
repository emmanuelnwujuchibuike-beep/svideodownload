import { InboxListSkeleton, InboxShell } from "@/features/social/inbox-shell";

/**
 * Inbox loading state.
 *
 * Renders the SAME shell as the page itself, so the only thing that changes
 * when the real data lands is the list body. This used to paint a grey
 * `Skeleton` block where the "Messages" title goes, with no subtitle and no
 * header actions — so entering /messages always flashed a placeholder title and
 * a missing profile button before the real header appeared, which is precisely
 * the "reloads too noticeable … the profile button at the top" report (owner,
 * 2026-07-16).
 */
export default function MessagesLoading() {
  return (
    <InboxShell>
      <span role="status" aria-live="polite" className="sr-only">
        Loading messages…
      </span>
      <InboxListSkeleton />
    </InboxShell>
  );
}
