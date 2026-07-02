import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { ConversationList } from "@/features/social/conversation-list";
import { listConversations } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function MessagesPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");

  const conversations = await listConversations(user.id);

  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-5 flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
          <MessageCircle className="h-6 w-6 text-primary" /> Messages
        </h1>
        <ConversationList initial={conversations} />
      </div>
    </AppContent>
  );
}
