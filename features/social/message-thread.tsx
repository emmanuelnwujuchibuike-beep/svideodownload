"use client";

import { useEffect, useRef } from "react";

import type { MessageItem } from "@/lib/social/messages";
import { cn } from "@/lib/utils";

/** Scrollable message bubbles; auto-scrolls to the latest on mount/update. */
export function MessageThread({ messages }: { messages: MessageItem[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={ref} className="flex-1 space-y-2 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Say hello 👋</p>
      ) : (
        messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.mine
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-secondary text-foreground",
              )}
            >
              {m.body}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
