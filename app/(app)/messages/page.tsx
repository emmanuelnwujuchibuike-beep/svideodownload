import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConversationList } from "@/features/social/conversation-list";
import { CreateGroupLauncher } from "@/features/social/create-group-launcher";
import { listConversations } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

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

  const conversations = await listConversations(user.id);

  return (
    <>
      {/* Mobile inbox */}
      <div className="flex-1 overflow-y-auto px-3 pt-4 lg:hidden">
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
          <MessageCircle className="h-6 w-6 text-primary" /> Messages
          <CreateGroupLauncher className="ml-auto" />
        </h1>
        <ConversationList initial={conversations} />
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
