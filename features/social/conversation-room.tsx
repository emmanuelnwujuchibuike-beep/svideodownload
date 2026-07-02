"use client";

import { Check, CheckCheck, Loader2, Send } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  delivered_at: string | null;
  read_at: string | null;
}

function receiptLabel(m: MessageItem): { label: string; read: boolean; delivered: boolean } {
  if (m.readAt) return { label: "Seen", read: true, delivered: true };
  if (m.deliveredAt) return { label: "Delivered", read: false, delivered: true };
  return { label: "Sent", read: false, delivered: false };
}

/**
 * Realtime 1:1 chat: seeded server-side (instant), then live. New messages arrive
 * over a Supabase channel scoped to this conversation; sends append optimistically.
 * Delivery/read receipts (Sent → Delivered → Seen) update live via UPDATE events.
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

  // Live: new messages (INSERT) + receipt changes (UPDATE) for this conversation.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          append({
            id: r.id,
            body: r.body,
            createdAt: r.created_at,
            mine: r.sender_id === viewerId,
            deliveredAt: r.delivered_at,
            readAt: r.read_at,
          });
          void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          setMessages((prev) =>
            prev.map((m) => (m.id === r.id ? { ...m, deliveredAt: r.delivered_at, readAt: r.read_at } : m)),
          );
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
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, body: text, createdAt: new Date().toISOString(), mine: true, deliveredAt: null, readAt: null },
    ]);
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

  // Show a receipt only under my most recent message (iMessage/IG style).
  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.mine) return messages[i]!.id;
    return null;
  }, [messages]);

  return (
    <>
      <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Say hello 👋</p>
        ) : (
          messages.map((m) => {
            const showReceipt = m.mine && m.id === lastMineId && !m.id.startsWith("optimistic-");
            const r = showReceipt ? receiptLabel(m) : null;
            return (
              <div key={m.id} className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[80%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                    m.mine
                      ? "rounded-br-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/20"
                      : "rounded-bl-lg border border-border/60 bg-card text-foreground shadow-sm",
                  )}
                >
                  {m.body}
                </div>
                {r ? (
                  <span
                    className={cn(
                      "mt-0.5 flex items-center gap-1 px-1 text-[10px] font-medium",
                      r.read ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {r.delivered ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    {r.label}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-border/60 bg-card/70 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:pb-3"
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message…"
          aria-label="Message"
          maxLength={2000}
          className="h-11 flex-1 rounded-2xl border border-border/60 bg-background/60 px-4 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-95 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </>
  );
}
