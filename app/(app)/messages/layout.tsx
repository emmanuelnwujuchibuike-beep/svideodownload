import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { ConversationList } from "@/features/social/conversation-list";
import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { listIncomingFriendRequests, type FriendRequestItem } from "@/lib/social/friends";
import { listConversations } from "@/lib/social/messages";
import { createClient, getUserBounded } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/utils";

const LOAD_TIMEOUT_MS = 8000;

/**
 * Glass Split (owner-picked design): on desktop the inbox is a persistent left
 * pane and the thread fills the right panel, so switching chats never reloads
 * the list. On mobile each route is full-screen (list ↔ thread) and the layout
 * reserves space for the bottom nav. The pane and the pages share INBOX_KEY,
 * so one realtime subscription keeps everything in lockstep.
 */
export default async function MessagesLayout({ children }: { children: ReactNode }) {
  let conversations: Awaited<ReturnType<typeof listConversations>> = [];
  let requests: FriendRequestItem[] = [];
  let viewerId = "";
  try {
    const supabase = await createClient();
    // Time-boxed auth + time-boxed queries (docs/STARTUP_AUDIT.md) — a stuck
    // call anywhere here used to leave the desktop pane on its skeleton
    // forever; every path now degrades to "shows an empty pane" (a real, if
    // imperfect, page) rather than never resolving at all.
    const auth = await getUserBounded(supabase);
    if (auth.kind === "user") {
      viewerId = auth.user.id;
      [conversations, requests] = await Promise.all([
        withTimeout(listConversations(auth.user.id), LOAD_TIMEOUT_MS, []),
        withTimeout(listIncomingFriendRequests(auth.user.id), LOAD_TIMEOUT_MS, []),
      ]);
    }
  } catch {
    /* pages handle their own auth redirects */
  }

  return (
    // Mobile height reservation: the global topbar HIDES on /messages below
    // lg (the owner's mockup starts straight at the "Messages" title), so
    // mobile only reserves the floating-pill nav's own box (~4.7rem measured
    // live 2026-07-12, incl. label + pill padding) + its bottom offset — the
    // SAME max(inset−10px, 6px) expression the nav itself uses
    // (mobile-nav.tsx), so browser tabs and the installed app (large
    // home-indicator inset) both come out exactly flush.
    <div className="mx-auto flex h-[calc(100dvh-4.3125rem-max(calc(env(safe-area-inset-bottom)-10px),0.375rem))] w-full max-w-[1600px] gap-4 px-0 pt-[env(safe-area-inset-top)] lg:h-[calc(100dvh-4rem)] lg:px-4 lg:py-4 lg:pt-4">
      {/* Desktop inbox pane — owner ask: white like WhatsApp, not the root
          layout's ambient blue→violet gradient bleeding through a translucent
          `bg-card/60`. Opaque `bg-white` blocks it outright. */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-white shadow-sm lg:flex">
        <h1 className="flex items-center gap-2 px-4 pb-2 pt-4 text-xl font-bold tracking-[-0.02em]">
          <ModuleIconBadge icon={MessageCircle} className="h-8 w-8" />
          Messages
          <InboxHeaderActions />
        </h1>
        <ConversationList initial={conversations} variant="pane" initialRequests={requests} viewerId={viewerId} />
      </aside>

      {/* Thread / index panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-3xl lg:border lg:border-border/70 lg:shadow-sm">
        {children}
      </main>
    </div>
  );
}
