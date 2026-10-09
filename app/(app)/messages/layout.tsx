import { MessageCircle } from "lucide-react";
import { Suspense, type ReactNode } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { ConversationList } from "@/features/social/conversation-list";
import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";
import { listIncomingFriendRequests, type FriendRequestItem } from "@/lib/social/friends";
import { listConversations, type ConversationSummary } from "@/lib/social/messages";
import { createClient, getUserBounded } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/utils";

const LOAD_TIMEOUT_MS = 8000;

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
    // offset — the SAME max(inset−10px, 6px) expression the nav itself uses.
    <div className="mx-auto flex h-[calc(100dvh-4.3125rem-max(calc(env(safe-area-inset-bottom)-10px),0.375rem))] w-full max-w-[1600px] gap-4 bg-background px-0 pt-[var(--frenz-safe-top)] lg:h-[calc(100dvh-4rem)] lg:bg-transparent lg:px-4 lg:py-4 lg:pt-4">
      {/* Desktop inbox pane — bg-background (not hardcoded white) blocks the
          root ambient wash while still following real dark/light mode. */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background shadow-sm lg:flex">
        <h1 className="flex items-center gap-2 px-4 pb-2 pt-4 text-xl font-bold tracking-[-0.02em]">
          <ModuleIconBadge icon={MessageCircle} className="h-8 w-8" />
          Messages
          <InboxHeaderActions />
        </h1>
        <Suspense fallback={<PaneSkeleton />}>
          <InboxPane />
        </Suspense>
      </aside>

      {/* Thread / index panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-3xl lg:border lg:border-border/70 lg:shadow-sm">
        {children}
      </main>
    </div>
  );
}

/**
 * The desktop pane's data — streamed, never on the render critical path. Every
 * path here degrades to "an empty pane" (a real, if imperfect, page) rather
 * than blocking or redirecting: a transient slow/failed auth just shows the
 * empty list, and the mobile page (which is what actually matters on an iOS
 * PWA) is entirely independent of this.
 */
async function InboxPane() {
  let conversations: ConversationSummary[] = [];
  let requests: FriendRequestItem[] = [];
  let viewerId = "";
  try {
    const supabase = await createClient();
    const auth = await getUserBounded(supabase);
    if (auth.kind === "user") {
      viewerId = auth.user.id;
      [conversations, requests] = await Promise.all([
        withTimeout(listConversations(auth.user.id), LOAD_TIMEOUT_MS, []),
        withTimeout(listIncomingFriendRequests(auth.user.id), LOAD_TIMEOUT_MS, []),
      ]);
    }
  } catch {
    /* pages handle their own auth redirects; the pane just shows empty */
  }

  return <ConversationList initial={conversations} variant="pane" initialRequests={requests} viewerId={viewerId} />;
}

function PaneSkeleton() {
  return (
    <div className="flex-1 space-y-1 px-3 pt-2" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl p-3">
          <SkeletonAvatar className="h-12 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}
