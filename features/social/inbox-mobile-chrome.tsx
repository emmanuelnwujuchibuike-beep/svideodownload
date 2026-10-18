"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useIsGuest } from "@/features/social/guest-chat";
import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { InboxStoriesRow } from "@/features/social/inbox-stories-row";
import { InboxUnreadDot } from "@/features/social/inbox-unread-dot";

/**
 * The mobile inbox's top chrome — the "Messages" title, the profile/tools
 * cluster, and the Stories strip — rendered from the PERSISTENT app shell rather
 * than from the /messages page.
 *
 * Why it lives here and not in the page (owner, reported repeatedly, most
 * recently 2026-07-18: "the profile buttons and stories section in inbox still
 * flash on swipe back … make them never reload even on swipe back"):
 *
 * Every other app page keeps its top chrome in the persistent `AppTopbar`, which
 * sits ABOVE the page-transition template and so never unmounts. The inbox hides
 * that topbar and used to render its own header + Stories INSIDE the page. On an
 * iOS back-swipe out of a chat, the page remounts, and — measured — the whole
 * inbox is ABSENT for the entire ~0.4s transition commit (the destination hasn't
 * rendered yet, and a Router-Cache hit shows no loading.tsx to bridge it). So the
 * header and Stories visibly disappeared and popped back — the "flash / reload on
 * swipe back". Moving them into the shell means they are mounted ONCE and stay
 * put across that gap, exactly like every other page's topbar.
 *
 * Mounted across the WHOLE `/messages` subtree — index AND thread — so the
 * back-swipe between them never unmounts it. While a thread is open its own
 * full-screen overlay (z-50) covers this (z-30); on `/messages` it's the visible
 * header. Unmounted entirely on every other route.
 *
 * It's `position: fixed`, so it doesn't consume layout height; the inbox list
 * pads itself clear of it via the `--inbox-chrome-h` custom property this
 * publishes (they're in different subtrees now — shell vs page — so a shared CSS
 * var is how the list learns this height, and a ResizeObserver keeps it exact as
 * the Stories row loads).
 */
// the streak chip shows only on the messages page, and this chrome is in the persistent shell — load it there, not everywhere

export function InboxMobileChrome() {
  const pathname = usePathname();
  const inMessages = pathname === "/messages" || pathname.startsWith("/messages/");
  const ref = useRef<HTMLDivElement>(null);
  const guest = useIsGuest();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--inbox-chrome-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inMessages, guest]);

  if (!inMessages) return null;

  return (
    <div
      ref={ref}
      // Mirrors the box the page header used to occupy: full-bleed, solid
      // `bg-background` (so the list scrolls UNDER it, never shows through), the
      // same `px-3 pt-3.5` insets, and pinned below the status-bar safe area.
      // `lg:hidden` — desktop keeps the inbox in the Glass Split pane, untouched.
      className="frenz-ui fixed inset-x-0 top-[var(--frenz-safe-top)] z-30 mx-auto max-w-[1600px] bg-frenz-page px-3 pt-4 lg:hidden"
    >
      {/* Tighter (2026-10-09 reference: "tighter header … less vertical space"). */}
      {/* The design's header (design/Messages.dc.html, 2026-10-18): the title in Sora and the three
          circles. The "Stay connected…" line is not in the design and went with it. */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 flex items-center gap-1.5 pl-1 font-heading text-[23px] font-extrabold leading-tight tracking-[-1px] text-frenz-ink min-[360px]:text-[26px] min-[390px]:text-[30px]">
            Messages
            <InboxUnreadDot />
          </h1>
          <InboxHeaderActions />
        </div>
        {/* owner 2026-10-09: the streak moved to your own profile page (StreakHeaderChip). */}
      </div>
      {/* no stories for a signed-out visitor: no "Your story" placeholder, nothing fetched (owner, 2026-10-16) */}
      {guest ? null : <InboxStoriesRow />}
    </div>
  );
}
