import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ConversationRoom } from "@/features/social/conversation-room";
import { ThreadHeader } from "@/features/social/thread-header";
import { getConversation } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Thread panel — fills the Glass Split right pane (full-screen on mobile). */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabase) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/${id}`);

  const convo = await getConversation(id, user.id);
  if (!convo) notFound();

  const { data: viewerProfile } = await supabase.from("profiles").select("display_name, handle").eq("id", user.id).maybeSingle();
  const viewerName = (viewerProfile?.display_name as string) || (viewerProfile?.handle ? `@${viewerProfile.handle as string}` : "You");

  return (
    // Mobile: a true full-viewport overlay — covers the persistent app
    // topbar AND bottom nav (z-50, above MobileNav's z-40) so an open thread
    // is genuinely full-screen like a real chat app, not just "below the
    // nav." Desktop (lg:) reverts to normal in-flow behavior inside the
    // Glass Split layout, where the topbar/sidebar stay visible alongside
    // the inbox pane — that's a dashboard, not a full-screen navigation, so
    // it's deliberately left untouched there.
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:flex-1 lg:bg-transparent">
      <ThreadHeader
        conversationId={convo.id}
        viewerId={user.id}
        type={convo.type}
        initialTitle={convo.title}
        initialAvatarUrl={convo.avatarUrl}
        initialMembers={convo.members}
        viewerRole={convo.viewerRole}
        other={convo.other}
      />

      <ConversationRoom
        conversationId={convo.id}
        viewerId={user.id}
        viewerName={viewerName}
        viewerHandle={(viewerProfile?.handle as string | null) ?? null}
        initial={convo.messages}
        initialSyncedAt={convo.syncedAt}
        type={convo.type}
        members={convo.members}
      />
    </div>
  );
}
