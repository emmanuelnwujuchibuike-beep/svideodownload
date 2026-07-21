"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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
export function InboxMobileChrome() {
  const pathname = usePathname();
  const inMessages = pathname === "/messages" || pathname.startsWith("/messages/");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--inbox-chrome-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inMessages]);

  if (!inMessages) return null;

  return (
    <div
      ref={ref}
      // Mirrors the box the page header used to occupy: full-bleed, solid
      // `bg-background` (so the list scrolls UNDER it, never shows through), the
      // same `px-3 pt-3.5` insets, and pinned below the status-bar safe area.
      // `lg:hidden` — desktop keeps the inbox in the Glass Split pane, untouched.
      className="fixed inset-x-0 top-[var(--frenz-safe-top)] z-30 mx-auto max-w-[1600px] bg-background px-3 pt-3.5 lg:hidden"
    >
      <div className="mb-3.5 flex items-start justify-between gap-2">
        <div className="pl-1">
          <h1 className="flex items-center gap-1.5 text-[28px] font-bold leading-tight tracking-[-0.03em]">
            Messages
            <InboxUnreadDot />
          </h1>
          <p className="mt-1 pl-0.5 text-xs text-muted-foreground">Stay connected with the people you care about</p>
        </div>
        <InboxHeaderActions />
      </div>
      <InboxStoriesRow />
    </div>
  );
}
