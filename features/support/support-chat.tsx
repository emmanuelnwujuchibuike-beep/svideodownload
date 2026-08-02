"use client";

import { Headset, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadMyThread, sendMyMessage } from "@/lib/support/actions";
import type { SupportMessage } from "@/lib/support/chat";
import { cn } from "@/lib/utils";

/**
 * The member side of Support Chat — a premium, iMessage-style 1:1 with the admin
 * team. Reads through the polled `loadMyThread` action (every few seconds while
 * the tab is visible) and writes through `sendMyMessage`, so a member sees admin
 * replies arrive without a manual refresh and never waits on a socket handshake.
 *
 * Guests see a clean sign-in prompt instead of the composer — the chat needs an
 * account to tie the conversation to, but the FAQ + email options on the page
 * around it work for everyone.
 */
const POLL_MS = 5000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function SupportChat() {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">("loading");
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const res = await loadMyThread();
    if (!res.signedIn) {
      setStatus("guest");
      return;
    }
    setStatus("ready");
    setMessages(res.thread?.messages ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText("");
    // Optimistic bubble — replaced by the server row on the next poll.
    const optimistic: SupportMessage = {
      id: `tmp-${Date.now()}`,
      senderRole: "user",
      body,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    const res = await sendMyMessage(body);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setText(body);
      return;
    }
    setMessages((m) => m.map((x) => (x.id === optimistic.id ? res.message : x)));
  }, [text, sending]);

  if (status === "loading") {
    return (
      <div className="flex h-[60vh] min-h-[26rem] items-center justify-center rounded-3xl border border-border/60 bg-card">
        <div className="frenz-route-indeterminate h-1 w-40 rounded-full bg-primary/10" />
      </div>
    );
  }

  if (status === "guest") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-border/60 bg-card px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-lg shadow-violet-500/30">
          <Headset className="h-7 w-7" />
        </span>
        <div>
          <h3 className="text-lg font-bold tracking-tight">Chat with our team</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Sign in to start a private 1:1 conversation with support. We&rsquo;ll reply here,
            and notify you by push and email the moment we do.
          </p>
        </div>
        <Link
          href="/login?next=/support"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition active:scale-[0.98]"
        >
          Sign in to chat
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[60vh] min-h-[26rem] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-card">
      {/* Agent header */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white">
          <Headset className="h-5 w-5" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">FrenzSave Support</p>
          <p className="text-xs text-muted-foreground">Typically replies within a day</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <Headset className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold">How can we help?</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Send us a message and our team will get back to you here.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === "user";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%]", mine ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                      mine
                        ? "rounded-br-md bg-gradient-to-br from-blue-600 to-violet-600 text-white"
                        : "rounded-bl-md bg-secondary text-foreground",
                    )}
                  >
                    {m.body}
                  </div>
                  <p className={cn("mt-1 px-1 text-[10px] text-muted-foreground", mine ? "text-right" : "text-left")}>
                    {m.senderRole === "admin" ? "Support · " : ""}
                    {timeLabel(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border/60 p-3">
        {error ? <p className="mb-2 px-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Type your message…"
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm outline-none ring-primary/40 transition focus:ring-2"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || text.trim().length === 0}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/30 transition active:scale-95 disabled:opacity-40"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
