import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { InstantInbox } from "@/features/social/instant-inbox";


/**
 * Glass Split (owner-picked design): on desktop the inbox is a persistent left
 * pane and the thread fills the right panel, so switching chats never reloads
 * the list. On mobile each route is full-screen (list ↔ thread) and the layout
 * reserves space for the bottom nav.
 *
 * IMPORTANT — this layout is SYNCHRONOUS on purpose (owner report 2026-07-16:
 * "/messages loads for seconds in the F loader / feels like it re-routes
 * through login on reload + iOS back-swipe; it should be standalone like every
 * other page"). It used to be an `async` layout that `await`ed the auth check
 * AND the conversation/friend-request queries (a ~14s combined worst case)
 * before returning ANY JSX. Because there's no Suspense/loading boundary
 * between the (app) layout and this one, those awaits blocked the ENTIRE
 * messages subtree — including the page's own `loading.tsx` skeleton — from
 * ever flushing, so a reload/back-gesture sat on a blank screen (or the boot
 * splash) for the whole duration. Worse, that blocking work only ever feeds
 * the DESKTOP pane below (`hidden lg:flex`), which mobile never even shows —
 * so an iOS PWA user was waiting seconds on data they don't see.
 *
 * Now the layout renders instantly and the pane's data streams in behind its
 * own <Suspense>, exactly like every other page's streamed sections. The
 * mobile inbox (messages/page.tsx) shows its skeleton immediately and does its
 * own auth, unblocked by the pane. No page here ever redirects through /login
 * on a transient auth blip — the page owns that decision, and the pane just
 * degrades to an empty list.
 */
export default function MessagesLayout({ children }: { children: ReactNode }) {
  return (
    // Mobile height reservation: the global topbar HIDES on /messages below
    // lg, so mobile only reserves the floating-pill nav's own box + its bottom
    // gap — `--frenz-nav-clearance`, the same variable the nav is built from.
    <div className="mx-auto flex h-[calc(100dvh-var(--frenz-nav-clearance))] w-full max-w-[1600px] gap-4 bg-background px-0 pt-[var(--frenz-safe-top)] lg:h-[calc(100dvh-4rem)] lg:bg-transparent lg:px-4 lg:py-4 lg:pt-4">
      {/* Desktop inbox pane — bg-background (not hardcoded white) blocks the
          root ambient wash while still following real dark/light mode. */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background shadow-sm lg:flex">
        <h1 className="flex items-center gap-2 px-4 pb-2 pt-4 text-xl font-bold tracking-[-0.02em]">
          <ModuleIconBadge icon={MessageCircle} className="h-8 w-8" />
          Messages
          <InboxHeaderActions />
        </h1>
        {/* 2026-10-10: painted from memory/the device like the mobile list — no server wait (features/social/instant-inbox.tsx) */}
        <InstantInbox variant="pane" />
      </aside>

      {/* Thread / index panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-3xl lg:border lg:border-border/70 lg:shadow-sm">
        {children}
      </main>
    </div>
  );
}
