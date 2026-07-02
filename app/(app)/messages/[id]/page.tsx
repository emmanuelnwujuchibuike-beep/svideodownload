import { ArrowLeft, BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConversationRoom } from "@/features/social/conversation-room";
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

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-2xl flex-col">
      {/* Conversation header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
        <Link href="/messages" aria-label="Back" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {convo.other ? (
          <Link href={`/u/${convo.other.handle}`} className="flex min-w-0 items-center gap-2.5">
            {convo.other.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={convo.other.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
                {convo.other.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold">
                <span className="truncate">{convo.other.displayName}</span>
                {convo.other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground">@{convo.other.handle}</span>
            </span>
          </Link>
        ) : (
          <span className="text-sm font-semibold text-muted-foreground">Unknown</span>
        )}
      </div>

      <ConversationRoom conversationId={convo.id} viewerId={user.id} initial={convo.messages} />
    </div>
  );
}
