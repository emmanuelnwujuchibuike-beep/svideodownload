import { MessageCircle, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConversationList } from "@/features/social/conversation-list";
import { CreateGroupLauncher } from "@/features/social/create-group-launcher";
import { MessageSearchLauncher } from "@/features/social/message-search-launcher";
import { NotificationSettingsPicker } from "@/features/social/notification-settings-picker";
import { PresenceStatusPicker } from "@/features/social/presence-status-picker";
import { listConversations, type ConversationSummary } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");

  // A stuck/slow query here used to leave the whole inbox on its loading
  // skeleton forever — nothing timed it out, so Next had nothing to fall
  // back to. Racing it means the WORST case is now "shows a retry prompt
  // after 8s", never "stuck indefinitely".
  const result = await withTimeout<LoadResult>(
    listConversations(user.id).then((c) => ({ ok: true, conversations: c })),
    LOAD_TIMEOUT_MS,
    { ok: false, conversations: [] },
  );
  const timedOut = !result.ok;
  const { conversations } = result;

  return (
    <>
      {/* Mobile inbox */}
      <div className="flex-1 overflow-y-auto px-3 pt-4 lg:hidden">
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
          <MessageCircle className="h-6 w-6 text-primary" /> Messages
          <span className="ml-auto flex items-center gap-1">
            <MessageSearchLauncher />
            <PresenceStatusPicker />
            <NotificationSettingsPicker />
            <CreateGroupLauncher />
          </span>
        </h1>
        {timedOut ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 p-10 text-center">
            <p className="text-sm font-medium">This is taking longer than usual</p>
            <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
            <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Link>
          </div>
        ) : (
          <ConversationList initial={conversations} />
        )}
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
