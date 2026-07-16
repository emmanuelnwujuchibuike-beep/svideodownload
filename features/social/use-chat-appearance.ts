"use client";

import { mutate } from "@/features/data/cache";
import { useQuery } from "@/features/data/use-query";
import { toast } from "@/features/ui/toast";
import { DEFAULT_CHAT_APPEARANCE, type ChatAppearance } from "@/lib/social/chat-appearance";

const keyFor = (conversationId: string) => `chat-appearance:${conversationId}`;

async function fetchAppearance(conversationId: string): Promise<ChatAppearance> {
  const res = await fetch(`/api/chat-appearance-preferences?conversationId=${encodeURIComponent(conversationId)}`);
  if (!res.ok) return DEFAULT_CHAT_APPEARANCE;
  const d = (await res.json()) as { appearance?: ChatAppearance };
  return d.appearance ?? DEFAULT_CHAT_APPEARANCE;
}

/**
 * Personal chat appearance (font style + bubble style/color) — PER-CONVERSATION
 * (owner ask 2026-07-16: "should be only changed in the particular chat ...
 * not in all chats"). Keyed per conversation on the app's shared
 * stale-while-revalidate cache, so a change in one thread never touches
 * another, and the open ConversationRoom + the settings sheet for the SAME
 * thread stay in lockstep with no reload.
 *
 * `initial` is the server-rendered value for this thread (getConversation
 * reads the viewer's row). Seeding it fixes the "shows the default blue bubble
 * for a moment every time you enter the chat, then switches to the saved
 * color" flash: the saved appearance now paints on the very first render
 * instead of after a client round-trip.
 */
export function useChatAppearance(conversationId: string, initial?: ChatAppearance): ChatAppearance {
  const { data } = useQuery(keyFor(conversationId), () => fetchAppearance(conversationId), {
    initialData: initial ?? DEFAULT_CHAT_APPEARANCE,
  });
  return data ?? initial ?? DEFAULT_CHAT_APPEARANCE;
}

/** Optimistic write with rollback-on-failure, scoped to one conversation. */
export async function setChatAppearance(conversationId: string, patch: Partial<ChatAppearance>): Promise<void> {
  const key = keyFor(conversationId);
  const rollback = mutate<ChatAppearance>(key, (prev) => ({ ...(prev ?? DEFAULT_CHAT_APPEARANCE), ...patch }));
  try {
    const res = await fetch("/api/chat-appearance-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, ...patch }),
    });
    if (!res.ok) throw new Error();
  } catch {
    rollback();
    toast("Couldn't save that change.", "error");
  }
}
