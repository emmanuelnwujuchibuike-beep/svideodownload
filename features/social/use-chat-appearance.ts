"use client";

import { mutate } from "@/features/data/cache";
import { useQuery } from "@/features/data/use-query";
import { toast } from "@/features/ui/toast";
import { DEFAULT_CHAT_APPEARANCE, type ChatAppearance } from "@/lib/social/chat-appearance";

const KEY = "chat-appearance";

async function fetchAppearance(): Promise<ChatAppearance> {
  const res = await fetch("/api/chat-appearance-preferences");
  if (!res.ok) return DEFAULT_CHAT_APPEARANCE;
  const d = (await res.json()) as { appearance?: ChatAppearance };
  return d.appearance ?? DEFAULT_CHAT_APPEARANCE;
}

/**
 * Personal chat appearance (font size + bubble style/color, owner ask
 * 2026-07-14: "reflect in both chats") — built on the app's existing
 * stale-while-revalidate cache (`features/data`) rather than a bespoke
 * singleton, specifically because `useQuery`'s `useSyncExternalStore` wiring
 * means every mounted consumer (an open ConversationRoom, the settings sheet
 * that just changed it) re-renders the instant `setChatAppearance` writes to
 * the shared cache — no manual event bus, no page reload, same "instant
 * everywhere" bar the rest of this round holds new features to.
 */
export function useChatAppearance(): ChatAppearance {
  const { data } = useQuery(KEY, fetchAppearance, { initialData: DEFAULT_CHAT_APPEARANCE });
  return data ?? DEFAULT_CHAT_APPEARANCE;
}

/** Optimistic write with rollback-on-failure, same shape as every other settings PATCH in this codebase. */
export async function setChatAppearance(patch: Partial<ChatAppearance>): Promise<void> {
  const rollback = mutate<ChatAppearance>(KEY, (prev) => ({ ...(prev ?? DEFAULT_CHAT_APPEARANCE), ...patch }));
  try {
    const res = await fetch("/api/chat-appearance-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error();
  } catch {
    rollback();
    toast("Couldn't save that change.", "error");
  }
}
