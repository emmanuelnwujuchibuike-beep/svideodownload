import { InboxShell } from "@/features/social/inbox-shell";
import { WarmInboxFallback } from "@/features/social/warm-inbox-fallback";

/**
 * Inbox loading state — the route-level fallback Next shows while the page's RSC
 * loads. On a back-swipe this renders BEFORE the page's own Suspense fallback, so
 * it has to be warm too or the flash comes back one level up.
 *
 * Renders the SAME shell as the page, so the header/stories never change. And the
 * list area uses WarmInboxFallback (not a grey skeleton): on a warm re-entry it
 * paints the real last-known conversations from the client cache, so entering
 * /messages by back-swipe shows the actual inbox from the very first frame — no
 * placeholder title, no missing profile button, no skeleton flash (owner,
 * 2026-07-16 / 2026-07-17: "i dont want any flash at all on every back swipe").
 * Only a true cold start (empty cache) falls through to the skeleton inside it.
 */
export default function MessagesLoading() {
  return (
    <InboxShell>
      <span role="status" aria-live="polite" className="sr-only">
        Loading messages…
      </span>
      <WarmInboxFallback />
    </InboxShell>
  );
}
