import type { ReactNode } from "react";

import { MessageCircle } from "lucide-react";

/**
 * The /messages index shell — the mobile list container, and the desktop "pick a
 * conversation" panel.
 *
 * Shared by `messages/page.tsx` AND `messages/loading.tsx` on purpose, so the
 * only thing that can ever change between the loading and loaded states is the
 * list body itself.
 *
 * The top chrome (the "Messages" title, the profile/tools cluster, the Stories
 * strip) is NO LONGER here — it moved to `InboxMobileChrome`, rendered from the
 * persistent app shell. It used to live in this page-level shell, so on an iOS
 * back-swipe out of a chat the whole header + Stories vanished for the
 * transition commit and popped back (the long-running "stories/profile flash on
 * swipe back"). In the shell it stays mounted across that gap. This scroller
 * pads its top by `--inbox-chrome-h` (published by InboxMobileChrome) so the
 * first row clears that fixed overlay.
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
      {/* `frenz-nav-bleed` grows this box down through the strip the messages
          layout reserves for the floating nav, and `frenz-nav-pad` on the
          scroller keeps the last row clear of the pill. Without the pair, the
          list stopped ~69px short of the bottom and left a dead band of page
          background under it, clipping the final row mid-row (owner, 2026-07-16:
          "there is a white background at the bottom covering chats, nothing is
          suppose to be there only the bottom nav"). The reservation itself has
          to stay for the THREAD, whose composer must sit above the nav. */}
      <div className="frenz-inbox-page frenz-nav-bleed flex-1 overflow-hidden bg-background lg:hidden">
        {/* pt = the fixed InboxMobileChrome's height (published as a CSS var),
            so the first conversation clears it. The fallback covers the first
            paint before the ResizeObserver has measured. */}
        <div
          className="frenz-nav-pad h-full overflow-y-auto overscroll-y-none px-3"
          // The ResizeObserver-published height is exact; the fallback only
          // covers the first paint before it fires. Sized a touch ABOVE the real
          // chrome (~234px) so that frame can only ever leave a hair of gap,
          // never overlap the first row under the header.
          style={{ paddingTop: "var(--inbox-chrome-h, 15rem)" }}
        >
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
