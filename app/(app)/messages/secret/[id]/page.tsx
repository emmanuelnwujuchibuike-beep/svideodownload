import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SecretChatRoom } from "@/features/social/secret-chat-room";
import { isPinLocked } from "@/lib/security/pin-gate";
import { getConversation } from "@/lib/social/messages";
import { createClient, getUserBounded } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secret Chat",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SecretChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const auth = await getUserBounded(supabase);
  if (auth.kind === "signed-out") redirect(`/login?next=/messages/secret/${id}`);
  if (auth.kind === "timeout") {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">Taking longer than usual — try again.</div>;
  }

  if (await isPinLocked(auth.user.id)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lock className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">Secret Chat locked</p>
        <p className="max-w-xs text-sm text-muted-foreground">Enter your PIN to view this conversation.</p>
      </div>
    );
  }

  const convo = await getConversation(id, auth.user.id);
  if (!convo || convo.type !== "secret" || !convo.other) notFound();

  return (
    <SecretChatRoom
      conversationId={convo.id}
      viewerId={auth.user.id}
      other={convo.other}
      initialMessages={convo.messages.map((m) => ({
        id: m.id,
        body: m.body,
        encryptionIv: m.encryptionIv,
        createdAt: m.createdAt,
        mine: m.mine,
        deletedAt: m.deletedAt,
      }))}
      initialSyncedAt={convo.syncedAt}
      initialDisappearAfterSeconds={convo.disappearAfterSeconds}
    />
  );
}
