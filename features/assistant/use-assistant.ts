"use client";

import { useCallback, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * `context` (Feature 15 Part 8) — optional real grounding data for a scoped
 * assistant surface, e.g. the Smart Discovery Assistant. Sent with every
 * message in the conversation, not just the first, so a follow-up question
 * later in the thread still has it.
 */
export function useAssistant(context?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || pending) return;

      const next: ChatMessage[] = [...messages, { role: "user", content }];
      setMessages(next);
      setPending(true);
      setError(null);

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next.slice(-12), context }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Something went wrong. Please try again.");
          return;
        }
        setMessages((m) => [...m, { role: "assistant", content: json.reply as string }]);
      } catch {
        setError("Network error. Please check your connection and try again.");
      } finally {
        setPending(false);
      }
    },
    [messages, pending, context],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, pending, error, send, reset };
}
