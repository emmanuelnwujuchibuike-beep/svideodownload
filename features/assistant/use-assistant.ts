"use client";

import { useCallback, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function useAssistant() {
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
          body: JSON.stringify({ messages: next.slice(-12) }),
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
    [messages, pending],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, pending, error, send, reset };
}
