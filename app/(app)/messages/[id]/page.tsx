import { ArrowLeft, BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConversationRoom } from "@/features/social/conversation-room";
import { PresenceBadge } from "@/features/social/presence-badge";
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Glass thread header */}
      <div className="relative flex items-center gap-3 border-b border-border/60 bg-card/70 px-4 py-3 backdrop-blur-xl">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-2xl" />
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="relative text-muted-foreground transition hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {convo.other ? (
          <Link href={`/u/${convo.other.handle}`} className="relative flex min-w-0 items-center gap-2.5">
            {convo.other.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={convo.other.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-violet-500/25" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white">
                {convo.other.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold">
                <span className="truncate">{convo.other.displayName}</span>
                {convo.other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
              </span>
              <PresenceBadge userId={convo.other.id} handle={convo.other.handle} />
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
