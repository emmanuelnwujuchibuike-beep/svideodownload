import { MessageCircle, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConversationList } from "@/features/social/conversation-list";
import { InboxHeaderActions } from "@/features/social/inbox-header-actions";
import { listIncomingFriendRequests, type FriendRequestItem } from "@/lib/social/friends";
import { listConversations, type ConversationSummary } from "@/lib/social/messages";
import { createClient, getUserBounded } from "@/lib/supabase/server";
import { FORCE_LIGHT_VARS } from "@/lib/theme/force-light-vars";
import { withTimeout } from "@/lib/utils";

type LoadResult = { ok: true; conversations: ConversationSummary[] } | { ok: false; conversations: ConversationSummary[] };

const LOAD_TIMEOUT_MS = 8000;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * /messages index. Mobile: the full-screen inbox. Desktop: the inbox lives in
 * the layout's left pane, so this route shows an elegant empty-thread panel.
 */
export default async function MessagesPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  // Time-boxed auth (docs/STARTUP_AUDIT.md) — a timeout renders the same
  // Retry state as a slow query below; only a real "no session" redirects.
  const auth = await getUserBounded(supabase);
  if (auth.kind === "signed-out") redirect("/login?next=/messages");

  // A stuck/slow query here used to leave the whole inbox on its loading
  // skeleton forever — nothing timed it out, so Next had nothing to fall
  // back to. Racing it means the WORST case is now "shows a retry prompt
  // after 8s", never "stuck indefinitely".
  const viewerId = auth.kind === "user" ? auth.user.id : "";
  const [result, requests] =
    auth.kind === "timeout"
      ? [{ ok: false as const, conversations: [] }, []]
      : await Promise.all([
          withTimeout<LoadResult>(
            listConversations(auth.user.id).then((c) => ({ ok: true, conversations: c })),
            LOAD_TIMEOUT_MS,
            { ok: false, conversations: [] },
          ),
          withTimeout<FriendRequestItem[]>(listIncomingFriendRequests(auth.user.id), LOAD_TIMEOUT_MS, []),
        ]);
  const timedOut = !result.ok;
  const { conversations } = result;
  const hasUnread = conversations.some((c) => c.unread);

  return (
    <>
      {/* Mobile inbox — header per the owner's mockup: big bold title + a
          "Stay connected..." subtitle, a small unread dot next to the title,
          and the action-circle cluster on the right. */}
      {/* Owner ask: messages should be white like WhatsApp, not tinted purple
          — the root layout's own ambient blue→violet gradient (app/layout.tsx,
          a `fixed -z-10` decoration behind every page) was bleeding through
          this route's empty space since this container had no background of
          its own. `bg-white` blocks it outright rather than just reducing it,
          matching the same "always white regardless of dark mode" choice
          already made for the thread itself.
          FORCE_LIGHT_VARS on top — real bug found 2026-07-14 (owner: "display
          bug when i switch to dark theme in messages, there is a conflict"):
          `bg-white` alone only fixes the BACKGROUND — every descendant text/
          icon/badge here still uses text-foreground/text-muted-foreground/
          bg-secondary/border-border, which are dark-mode-REACTIVE, so in
          actual dark mode they rendered near-white-on-white (illegible) or
          picked up a stray dark-mode bg-background from a nested element
          (the swipe-gesture wrapper in conversation-list.tsx). Overriding the
          CSS variables themselves fixes every one of those call sites at
          once instead of hunting each down by hand. */}
      {/* Outer: full-bleed white + `overflow-hidden` CLIPS the box — nothing
          behind it (app/layout.tsx's fixed ambient blue→violet gradient) can
          ever show through, no matter what the scrollable inner does. Inner:
          the actual `overflow-y-auto` scroller, plus `overscroll-contain` so
          an iOS rubber-band bounce at the very top/bottom stays inside this
          box instead of chaining to the page and flashing the gradient behind
          it (owner-reported: "different color at the bottom when I slide up
          / top when I slide down" — the classic overscroll bleed-through;
          owner's own fix request, "overflow-y hidden but still scrollable",
          is exactly this two-layer clip+scroll split). */}
      <div className="flex-1 overflow-hidden bg-white lg:hidden" style={FORCE_LIGHT_VARS}>
        <div className="h-full overflow-y-auto overscroll-y-none px-3 pt-4">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h1 className="flex items-center gap-1.5 text-[28px] font-bold tracking-[-0.03em]">
                Messages
                {hasUnread ? (
                  <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--brand-purple))]" />
                ) : null}
              </h1>
              <p className="text-sm text-muted-foreground">Stay connected with the people you care about</p>
            </div>
            <InboxHeaderActions />
          </div>
          {timedOut ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 p-10 text-center">
              <p className="text-sm font-medium">This is taking longer than usual</p>
              <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
              <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Link>
            </div>
          ) : (
            <ConversationList initial={conversations} initialRequests={requests} viewerId={viewerId} />
          )}
        </div>
      </div>

      {/* Desktop: pick-a-conversation state */}
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 lg:flex">
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
