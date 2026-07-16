import type { ReactNode } from "react";

import { MessageCircle } from "lucide-react";

import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { InboxUnreadDot } from "@/features/social/inbox-unread-dot";

/**
 * The /messages index shell — the mobile container + its header, and the
 * desktop "pick a conversation" panel.
 *
 * Shared by `messages/page.tsx` AND `messages/loading.tsx` on purpose. Owner
 * (2026-07-16): "the message pages should never reload visibly when swiped
 * back … no object including the profile button at the top of the message page
 * should never reload."
 *
 * Two things had to be true for that. First, the header can't depend on server
 * data (it doesn't any more — see the page's note; the unread dot reads the
 * client inbox cache). Second, the loading state and the loaded state have to
 * be the SAME markup, or the swap between them is itself a visible reload — the
 * old `loading.tsx` painted a grey `Skeleton` block where the "Messages" title
 * goes and had no header actions at all, so every entry flashed a placeholder
 * title and a missing profile button before the real ones appeared.
 *
 * Rendering one shell from both places means the only thing that can ever
 * change between them is the list body below.
 */
export function InboxShell({ children }: { children: ReactNode }) {
  return (
    <>
      {/* `bg-background` (NOT a hardcoded `bg-white`) blocks the root layout's
          ambient blue→violet gradient from bleeding through this route's empty
          space while still following the app's real dark/light mode.
          Outer: `overflow-hidden` CLIPS the box. Inner: the actual scroller,
          plus `overscroll-y-none` so an iOS rubber-band bounce stays inside
          this box instead of chaining to the page and flashing the gradient. */}
      <div className="frenz-inbox-page flex-1 overflow-hidden bg-background lg:hidden">
        <div className="h-full overflow-y-auto overscroll-y-none px-3 pt-3.5">
          <div className="mb-3.5 flex items-start justify-between gap-2">
            {/* The title block sits a touch off the true edge and the subtitle
                reads as a distinct, smaller second line (owner, 2026-07-15). */}
            <div className="pl-1">
              <h1 className="flex items-center gap-1.5 text-[28px] font-bold leading-tight tracking-[-0.03em]">
                Messages
                <InboxUnreadDot />
              </h1>
              <p className="mt-1 pl-0.5 text-xs text-muted-foreground">Stay connected with the people you care about</p>
            </div>
            <InboxHeaderActions />
          </div>

          {children}
        </div>
      </div>

      {/* Desktop: pick-a-conversation state */}
      <div className="frenz-desktop-empty hidden flex-1 flex-col items-center justify-center gap-3 lg:flex">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20">
          <MessageCircle className="h-7 w-7 text-violet-500 dark:text-violet-300" />
        </span>
        <p className="text-base font-semibold">Your messages</p>
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          Select a conversation on the left, or open a friend&apos;s profile and tap Message.
        </p>
      </div>
    </>
  );
}

/** The list-area placeholder. Sized to match a real conversation row so the
 *  swap to real content doesn't shift anything. */
export function InboxListSkeleton() {
  return (
    <div className="space-y-1" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl p-3">
          <span className="h-[52px] w-[52px] shrink-0 animate-pulse rounded-full bg-secondary" />
          <div className="flex-1 space-y-2">
            <span className="block h-3.5 w-32 animate-pulse rounded bg-secondary" />
            <span className="block h-3 w-44 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}
