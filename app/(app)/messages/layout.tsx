import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { ConversationList } from "@/features/social/conversation-list";
import { CreateGroupLauncher } from "@/features/social/create-group-launcher";
import { NotificationSettingsPicker } from "@/features/social/notification-settings-picker";
import { PresenceStatusPicker } from "@/features/social/presence-status-picker";
import { listConversations } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";
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
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Same reasoning as page.tsx's identical guard — a stuck query here used
    // to leave the desktop pane on its skeleton forever; racing it means it
    // degrades to "shows an empty pane" (a real, if imperfect, page) rather
    // than never resolving at all.
    if (user) conversations = await withTimeout(listConversations(user.id), LOAD_TIMEOUT_MS, []);
  } catch {
    /* pages handle their own auth redirects */
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem-3.6rem)] w-full max-w-[1600px] gap-4 px-0 lg:h-[calc(100dvh-4rem)] lg:px-4 lg:py-4">
      {/* Desktop inbox pane */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/60 shadow-sm backdrop-blur-xl lg:flex">
        <h1 className="flex items-center gap-2 px-4 pb-2 pt-4 text-xl font-bold tracking-[-0.02em]">
          <ModuleIconBadge icon={MessageCircle} className="h-8 w-8" />
          Messages
          <span className="ml-auto flex items-center gap-1">
            <PresenceStatusPicker />
            <NotificationSettingsPicker />
            <CreateGroupLauncher />
          </span>
        </h1>
        <ConversationList initial={conversations} variant="pane" />
      </aside>

      {/* Thread / index panel */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden lg:rounded-3xl lg:border lg:border-border/70 lg:bg-card/40 lg:shadow-sm lg:backdrop-blur-xl">
        {children}
      </main>
    </div>
  );
}
