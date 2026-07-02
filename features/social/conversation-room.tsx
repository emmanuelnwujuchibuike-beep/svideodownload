"use client";

import { Loader2, Send } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { revalidate } from "@/features/data";
import { INBOX_KEY, loadInbox } from "@/features/social/inbox";
import type { MessageItem } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface RawMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * Realtime 1:1 chat: seeded server-side (instant), then live. New messages arrive
 * over a Supabase channel scoped to this conversation; sends append optimistically
 * so the sender sees their message immediately without a page refresh.
 */
export function ConversationRoom({
  conversationId,
  viewerId,
  initial,
}: {
  conversationId: string;
  viewerId: string;
  initial: MessageItem[];
}) {
  const [messages, setMessages] = useState<MessageItem[]>(initial);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.map((m) => m.id)));

  const append = useCallback((m: MessageItem) => {
    setMessages((prev) => {
      if (seen.current.has(m.id)) return prev;
      // My own realtime echo reconciles with the optimistic bubble I already
      // showed (same body, temp id) instead of appending a duplicate.
      if (m.mine) {
        const idx = prev.findIndex((x) => x.id.startsWith("optimistic-") && x.body === m.body);
        if (idx !== -1) {
          seen.current.add(m.id);
          const copy = prev.slice();
          copy[idx] = m;
          return copy;
        }
      }
      seen.current.add(m.id);
      return [...prev, m];
    });
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  // Live subscription to inserts in this conversation.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          append({ id: r.id, body: r.body, createdAt: r.created_at, mine: r.sender_id === viewerId });
          // Keep the inbox badge/list in sync as the thread moves.
          void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
        },
      )
      .subscribe();
    return () => void channel.unsubscribe();
  }, [conversationId, viewerId, append]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    // Optimistic: show it now; the realtime echo reconciles it (see `append`).
    const optimisticId = `optimistic-${Date.now()}`;
    setMessages((prev) => [...prev, { id: optimisticId, body: text, createdAt: new Date().toISOString(), mine: true }]);
    setBody("");
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: text }),
      });
    } catch {
      /* the realtime insert (if it landed) will still reconcile */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Say hello 👋</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
                )}
              >
                {m.body}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-border/60 bg-background p-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message…"
          aria-label="Message"
          maxLength={2000}
          className="h-11 flex-1 rounded-xl bg-secondary/40 px-4 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </>
  );
}
