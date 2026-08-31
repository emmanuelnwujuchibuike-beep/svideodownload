"use client";

import { Headset, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  adminClearThread,
  adminLoadMessages,
  adminLoadThreads,
  adminSendReply,
} from "@/lib/support/actions";
import type { AdminSupportThread, SupportMessage } from "@/lib/support/chat";
import { cn } from "@/lib/utils";

import { useAdminLive } from "./live/use-admin-live";

/**
 * The admin side of Support Chat — a two-pane inbox: threads on the left (newest
 * activity first, unread badge), the selected conversation on the right with a
 * reply box. Both panes refresh so an operator sees new messages without a
 * manual reload; sending a reply notifies the member by push + email
 * (server-side, via postAdminReply).
 *
 * 🔴 The cadences were 5s and 4s (owner, 2026-08-30: runaway Vercel spend on a
 * dashboard left open for hours). Between them that was 1,620 server actions an
 * hour from a support inbox that, at ~90–100 daily users, receives a handful of
 * messages a DAY. Worse, the `setInterval`s kept firing while the tab was
 * hidden — each tick checked `visibilityState` and returned, so the timer cost
 * remained and only the request was skipped, which is the wrong half to save.
 *
 * Both panes now run on the SHARED admin scheduler (`features/admin/live/`),
 * which stops dead while the tab is hidden and backs off on failure: the thread
 * LIST at the `stats` tier (60s) and the OPEN thread at `live` (15s). A support
 * reply is not a real-time medium; the member is not sitting in the thread
 * waiting on a 4-second refresh.
 *
 * Data comes only through getAdminUser-guarded actions, so this renders empty for
 * anyone who somehow reaches it without admin rights.
 */
// Cadence now comes from the scheduler's tiers, not from constants here.

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function threadName(t: AdminSupportThread): string {
  return t.displayName || (t.handle ? `@${t.handle}` : t.email || "Member");
}

export function SupportInbox() {
  const [threads, setThreads] = useState<AdminSupportThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const refreshThreads = useCallback(async () => {
    const list = await adminLoadThreads();
    setThreads(list);
    setLoaded(true);
    setActiveId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  const refreshMessages = useCallback(async (threadId: string) => {
    const list = await adminLoadMessages(threadId);
    setMessages(list);
  }, []);

  /*
    The scheduler drives both panes. It fetches immediately on subscribe, so the
    separate priming call each of these effects used to make is gone — that was
    a duplicate request on every mount and on every thread switch.
  */
  useAdminLive<null>({
    key: "admin:support:threads",
    tier: "stats",
    fetcher: async () => {
      await refreshThreads();
      return null;
    },
  });

  useAdminLive<null>({
    // Keyed by thread: switching threads is different data, and the old key's
    // entry is dropped when its last subscriber goes — so a closed thread stops
    // being fetched rather than lingering.
    key: `admin:support:messages:${activeId ?? "none"}`,
    tier: "live",
    fetcher: async () => {
      if (activeId) await refreshMessages(activeId);
      return null;
    },
  });

  // Opening a thread clears its unread; reflect that in the list immediately.
  useEffect(() => {
    if (!activeId) return;
    setThreads((ts) => ts.map((t) => (t.id === activeId ? { ...t, adminUnread: 0 } : t)));
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = useCallback(async () => {
    const body = reply.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    setError(null);
    setReply("");
    const optimistic: SupportMessage = {
      id: `tmp-${Date.now()}`,
      senderRole: "admin",
      body,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    const res = await adminSendReply(activeId, body);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setReply(body);
      return;
    }
    setMessages((m) => m.map((x) => (x.id === optimistic.id ? res.message : x)));
    void refreshThreads();
  }, [reply, activeId, sending, refreshThreads]);

  const clearThread = useCallback(async () => {
    if (!activeId) return;
    if (!window.confirm("Delete this conversation? This permanently removes it and all its messages for both sides.")) return;
    const id = activeId;
    setThreads((ts) => ts.filter((t) => t.id !== id));
    setActiveId(null);
    setMessages([]);
    await adminClearThread(id);
    void refreshThreads();
  }, [activeId, refreshThreads]);

  const active = threads.find((t) => t.id === activeId) ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-[300px_1fr]">
      {/* Thread list */}
      <div className="rounded-2xl border border-border/60 bg-card">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-bold">Conversations</p>
          <p className="text-xs text-muted-foreground">
            {loaded ? `${threads.length} total` : "Loading…"}
          </p>
        </div>
        <div className="max-h-[32rem] overflow-y-auto">
          {loaded && threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted-foreground">
              <Headset className="h-6 w-6" />
              <p className="text-sm">No support conversations yet.</p>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left transition hover:bg-secondary/60",
                  t.id === activeId && "bg-secondary/70",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                  {t.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    threadName(t).charAt(0).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{threadName(t)}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeLabel(t.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {t.lastSender === "admin" ? "You: " : ""}
                      {t.lastMessage ?? "—"}
                    </span>
                    {t.adminUnread > 0 ? (
                      <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {t.adminUnread > 9 ? "9+" : t.adminUnread}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex h-[36rem] flex-col rounded-2xl border border-border/60 bg-card">
        {active ? (
          <>
            <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                {active.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={active.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  threadName(active).charAt(0).toUpperCase()
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{threadName(active)}</p>
                <p className="truncate text-xs text-muted-foreground">{active.email ?? active.handle ?? ""}</p>
              </div>
              <button
                type="button"
                onClick={() => void clearThread()}
                aria-label="Delete conversation"
                className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-rose-500 active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
              {messages.map((m) => {
                const admin = m.senderRole === "admin";
                return (
                  <div key={m.id} className={cn("flex", admin ? "justify-end" : "justify-start")}>
                    <div className="max-w-[75%]">
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                          admin
                            ? "rounded-br-md bg-gradient-to-br from-blue-600 to-violet-600 text-white"
                            : "rounded-bl-md bg-secondary text-foreground",
                        )}
                      >
                        {m.body}
                      </div>
                      <p className={cn("mt-1 px-1 text-[10px] text-muted-foreground", admin ? "text-right" : "text-left")}>
                        {timeLabel(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div className="border-t border-border/60 p-3">
              {error ? <p className="mb-2 px-1 text-xs font-medium text-rose-600">{error}</p> : null}
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder="Type a reply…"
                  className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm outline-none ring-primary/40 transition focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || reply.trim().length === 0}
                  aria-label="Send reply"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md transition active:scale-95 disabled:opacity-40"
                >
                  <Send className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Headset className="h-7 w-7" />
            <p className="text-sm">{loaded ? "Select a conversation" : "Loading…"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
