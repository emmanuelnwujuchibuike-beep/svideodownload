"use client";

import { Check, CheckCheck, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Reply as ReplyIcon, Send, SmilePlus, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { revalidate } from "@/features/data";
import { INBOX_KEY, loadInbox } from "@/features/social/inbox";
import { extractSharedPost, MessagePostEmbed } from "@/features/social/message-post-embed";
import { MESSAGE_REACTIONS } from "@/lib/social/message-meta";
import type { ConversationMember, ConversationType, MessageItem } from "@/lib/social/messages";
import { useVisualViewport } from "@/lib/pwa/use-visual-viewport";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface RawMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned: boolean;
}

function receiptLabel(m: MessageItem): { label: string; read: boolean; delivered: boolean } {
  if (m.readAt) return { label: "Seen", read: true, delivered: true };
  if (m.deliveredAt) return { label: "Delivered", read: false, delivered: true };
  return { label: "Sent", read: false, delivered: false };
}

/**
 * Realtime chat (direct + group): seeded server-side (instant), then live. New
 * messages arrive over a Supabase channel scoped to this conversation; sends
 * append optimistically. Delivery/read receipts (Sent → Delivered → Seen) —
 * direct threads only — update live via UPDATE events. Reply/edit/delete/pin
 * ride the SAME `messages` UPDATE/INSERT subscription (they're just more
 * columns on a row this channel already watches); reactions get their own
 * lightweight subscription that triggers the existing catch-up resync rather
 * than hand-rolling incremental patching from partial realtime payloads.
 */
export function ConversationRoom({
  conversationId,
  viewerId,
  initial,
  type = "direct",
  members = [],
}: {
  conversationId: string;
  viewerId: string;
  initial: MessageItem[];
  type?: ConversationType;
  members?: ConversationMember[];
}) {
  const [messages, setMessages] = useState<MessageItem[]>(initial);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.map((m) => m.id)));
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());
  const messagesRef = useRef<MessageItem[]>(initial);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

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

  // Auto-scroll to the newest message — also re-runs when the on-screen
  // keyboard opens/closes (its height changes the thread's own scroll
  // height even though no new message arrived), so the latest bubble never
  // ends up hidden behind the keyboard the moment the composer is focused.
  const { height: viewportHeight } = useVisualViewport();
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, viewportHeight]);

  // Catch-up resync: `postgres_changes` has NO replay — messages sent while the
  // socket was suspended (backgrounded phone, tunnel, sleep) are lost from the
  // live stream. Refetch + MERGE (never replace — optimistic bubbles awaiting
  // their echo must survive) whenever the app resumes, comes back online, the
  // channel re-subscribes after a drop, or a reaction changed (see below).
  const resyncing = useRef(false);
  const resync = useCallback(async () => {
    if (resyncing.current) return;
    resyncing.current = true;
    try {
      const res = await fetch(`/api/messages/${conversationId}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { messages: MessageItem[] };
      if (!d.messages) return;
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        let changed = false;
        for (const m of d.messages) {
          const cur = byId.get(m.id);
          if (!cur) {
            seen.current.add(m.id);
            changed = true;
          } else if (
            cur.readAt !== m.readAt ||
            cur.deliveredAt !== m.deliveredAt ||
            cur.body !== m.body ||
            cur.editedAt !== m.editedAt ||
            cur.deletedAt !== m.deletedAt ||
            cur.pinned !== m.pinned ||
            cur.reactions.length !== m.reactions.length ||
            cur.reactions.some((r, i) => r.count !== m.reactions[i]?.count || r.mine !== m.reactions[i]?.mine)
          ) {
            changed = true;
          }
          byId.set(m.id, m);
        }
        if (!changed) return prev;
        // Server order for confirmed messages; optimistic bubbles awaiting
        // their echo stay last — unless the server confirms they landed, or
        // they're old enough (20s) to be a genuinely failed send (ghost).
        const optimistic = prev.filter(
          (m) =>
            m.id.startsWith("optimistic-") &&
            !d.messages.some((s) => s.mine && s.body === m.body) &&
            Date.now() - new Date(m.createdAt).getTime() < 20_000,
        );
        return [...d.messages, ...optimistic];
      });
      void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
    } catch {
      /* offline — the next resume/reconnect retries */
    } finally {
      resyncing.current = false;
    }
  }, [conversationId]);

  // Live: new messages (INSERT), receipt/edit/delete/pin changes (UPDATE),
  // and reactions (their own lightweight channel — a reaction changing is
  // rare enough per-thread that reusing the tested resync() path is simpler
  // and more correct than hand-rolling partial realtime payload patching).
  useEffect(() => {
    const supabase = createClient();
    let everSubscribed = false;
    let reactionDebounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const r = payload.new as RawMessage;
          const parent = r.reply_to_id ? messagesRef.current.find((x) => x.id === r.reply_to_id) : null;
          append({
            id: r.id,
            body: r.body,
            createdAt: r.created_at,
            mine: r.sender_id === viewerId,
            senderId: r.sender_id,
            deliveredAt: r.delivered_at,
            readAt: r.read_at,
            replyTo: parent ? { id: parent.id, body: parent.body, senderId: parent.senderId, deleted: !!parent.deletedAt } : null,
            editedAt: r.edited_at,
            deletedAt: r.deleted_at,
            pinned: r.pinned,
            reactions: [],
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
            prev.map((m) =>
              m.id === r.id
                ? {
                    ...m,
                    body: r.deleted_at ? "" : r.body,
                    deliveredAt: r.delivered_at,
                    readAt: r.read_at,
                    editedAt: r.edited_at,
                    deletedAt: r.deleted_at,
                    pinned: r.pinned,
                  }
                : m,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions", filter: `conversation_id=eq.${conversationId}` },
        () => {
          if (reactionDebounce) clearTimeout(reactionDebounce);
          reactionDebounce = setTimeout(() => void resync(), 400);
        },
      )
      .subscribe((status) => {
        // A RE-subscribe means the socket dropped at some point — catch up on
        // whatever the live stream missed while it was down.
        if (status === "SUBSCRIBED") {
          if (everSubscribed) void resync();
          everSubscribed = true;
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      if (reactionDebounce) clearTimeout(reactionDebounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void channel.unsubscribe();
    };
  }, [conversationId, viewerId, append, resync]);

  const cancelReplyOrEdit = () => {
    setReplyingTo(null);
    setEditingId(null);
    setBody("");
  };

  const startEdit = (m: MessageItem) => {
    setReplyingTo(null);
    setEditingId(m.id);
    setBody(m.body);
    setOpenMenuId(null);
  };

  const startReply = (m: MessageItem) => {
    setEditingId(null);
    setReplyingTo(m);
    setOpenMenuId(null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);

    if (editingId) {
      const id = editingId;
      const prevBody = messages.find((m) => m.id === id)?.body ?? "";
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: text, editedAt: new Date().toISOString() } : m)));
      setEditingId(null);
      setBody("");
      try {
        const res = await fetch(`/api/messages/msg/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        if (!res.ok) setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: prevBody, editedAt: null } : m)));
      } catch {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: prevBody, editedAt: null } : m)));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Optimistic: show it now; the realtime echo reconciles it (see `append`).
    const optimisticId = `optimistic-${Date.now()}`;
    const replyTo = replyingTo
      ? { id: replyingTo.id, body: replyingTo.body, senderId: replyingTo.senderId, deleted: !!replyingTo.deletedAt }
      : null;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        body: text,
        createdAt: new Date().toISOString(),
        mine: true,
        senderId: viewerId,
        deliveredAt: null,
        readAt: null,
        replyTo,
        editedAt: null,
        deletedAt: null,
        pinned: false,
        reactions: [],
      },
    ]);
    setBody("");
    const replyToId = replyingTo?.id;
    setReplyingTo(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: text, replyToId }),
      });
      if (!res.ok) {
        // Confirmed failure — remove the ghost bubble and give the text back.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setBody(text);
      }
    } catch {
      // Network dropped mid-send: the message may or may not have landed —
      // resync decides (reconciles the echo or drops the ghost).
      void resync();
    } finally {
      setBusy(false);
    }
  };

  const deleteMsg = async (id: string) => {
    setOpenMenuId(null);
    const prev = messages;
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, body: "", deletedAt: new Date().toISOString(), pinned: false } : m)));
    try {
      const res = await fetch(`/api/messages/msg/${id}`, { method: "DELETE" });
      if (!res.ok) setMessages(prev);
    } catch {
      setMessages(prev);
    }
  };

  const togglePin = async (m: MessageItem) => {
    setOpenMenuId(null);
    const next = !m.pinned;
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: next } : x)));
    try {
      const res = await fetch(`/api/messages/msg/${m.id}/pin`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: !next } : x)));
    } catch {
      setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: !next } : x)));
    }
  };

  const react = async (messageId: string, emoji: string) => {
    setReactingId(null);
    setOpenMenuId(null);
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== messageId) return m;
        const withoutMine = m.reactions.map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
        const existing = withoutMine.find((r) => r.emoji === emoji);
        const reactions = existing
          ? withoutMine.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
          : [...withoutMine, { emoji, count: 1, mine: true }];
        return { ...m, reactions };
      }),
    );
    try {
      await fetch(`/api/messages/msg/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
    } catch {
      /* the reaction-channel resync reconciles on the next tick */
    } finally {
      void resync();
    }
  };

  // Show a receipt only under my most recent message (iMessage/IG style) — direct threads only.
  const lastMineId = useMemo(() => {
    if (type !== "direct") return null;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.mine) return messages[i]!.id;
    return null;
  }, [messages, type]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned && !m.deletedAt), [messages]);

  const scrollToMessage = (id: string) => {
    bubbleRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const senderName = (id: string): string => memberById.get(id)?.displayName ?? "Someone";

  return (
    <>
      {pinnedMessages.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToMessage(pinnedMessages[0]!.id)}
          className="flex items-center gap-2 border-b border-border/60 bg-secondary/40 px-4 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-secondary/60"
        >
          <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">
            {pinnedMessages[0]!.deletedAt ? "Pinned message" : pinnedMessages[0]!.body || "Pinned message"}
          </span>
          {pinnedMessages.length > 1 ? <span className="ml-auto shrink-0">+{pinnedMessages.length - 1} more</span> : null}
        </button>
      ) : null}

      <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Say hello</p>
        ) : (
          messages.map((m) => {
            const showReceipt = m.mine && m.id === lastMineId && !m.id.startsWith("optimistic-");
            const r = showReceipt ? receiptLabel(m) : null;
            const deleted = !!m.deletedAt;
            // A shared post link renders as a rich preview card (creator,
            // cover, caption) with any note above it — never a raw URL.
            const shared = !deleted ? extractSharedPost(m.body) : null;
            const canEdit = m.mine && !deleted && !m.id.startsWith("optimistic-");
            const canDelete = m.mine && !deleted && !m.id.startsWith("optimistic-");
            const canAct = !deleted && !m.id.startsWith("optimistic-");
            return (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) bubbleRefs.current.set(m.id, el);
                  else bubbleRefs.current.delete(m.id);
                }}
                className={cn("group flex flex-col", m.mine ? "items-end" : "items-start")}
              >
                {type === "group" && !m.mine ? (
                  <span className="mb-0.5 px-1 text-[11px] font-semibold text-muted-foreground">{senderName(m.senderId)}</span>
                ) : null}
                <div className={cn("flex items-end gap-1", m.mine ? "flex-row-reverse" : "flex-row")}>
                  <div
                    className={cn(
                      "max-w-[80%] whitespace-pre-wrap break-words rounded-3xl text-sm leading-relaxed",
                      deleted ? "px-4 py-2.5 italic text-muted-foreground" : shared ? "p-1.5" : "px-4 py-2.5",
                      deleted
                        ? "border border-dashed border-border/60 bg-transparent"
                        : m.mine
                          ? "rounded-br-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/20"
                          : "rounded-bl-lg border border-border/60 bg-card text-foreground shadow-sm",
                    )}
                  >
                    {deleted ? (
                      "This message was deleted"
                    ) : (
                      <>
                        {m.replyTo ? (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(m.replyTo!.id)}
                            className={cn(
                              "mb-1 block w-full truncate rounded-xl px-2.5 py-1 text-left text-[11px]",
                              m.mine ? "bg-white/15 text-white/85" : "bg-secondary text-muted-foreground",
                              shared && "mx-1.5 mt-1.5",
                            )}
                          >
                            {m.replyTo.deleted ? "Deleted message" : m.replyTo.body || "Message"}
                          </button>
                        ) : null}
                        {shared ? (
                          <>
                            {shared.text ? <span className="block px-2.5 pb-1.5 pt-1">{shared.text}</span> : null}
                            <MessagePostEmbed postId={shared.postId} mine={m.mine} />
                          </>
                        ) : (
                          m.body
                        )}
                      </>
                    )}
                  </div>

                  {canAct ? (
                    <div className="relative shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                        aria-label="Message actions"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openMenuId === m.id ? (
                        <>
                          <button
                            type="button"
                            aria-label="Close menu"
                            onClick={() => setOpenMenuId(null)}
                            className="fixed inset-0 z-40 cursor-default"
                          />
                          <div
                            className={cn(
                              "absolute top-8 z-50 w-40 overflow-hidden rounded-2xl border border-border/70 bg-card py-1 shadow-elevated",
                              m.mine ? "right-0" : "left-0",
                            )}
                          >
                            <MenuItem icon={ReplyIcon} label="Reply" onClick={() => startReply(m)} />
                            <MenuItem icon={SmilePlus} label="React" onClick={() => setReactingId(m.id)} />
                            <MenuItem
                              icon={m.pinned ? PinOff : Pin}
                              label={m.pinned ? "Unpin" : "Pin"}
                              onClick={() => togglePin(m)}
                            />
                            {canEdit ? <MenuItem icon={Pencil} label="Edit" onClick={() => startEdit(m)} /> : null}
                            {canDelete ? (
                              <MenuItem icon={Trash2} label="Delete" tone="danger" onClick={() => deleteMsg(m.id)} />
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {reactingId === m.id ? (
                  <div className="mt-1 flex items-center gap-1 rounded-full border border-border/60 bg-card px-2 py-1 shadow-sm">
                    {MESSAGE_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => react(m.id, emoji)}
                        aria-label={`React ${emoji}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-base transition hover:scale-125"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}

                {m.reactions.length > 0 ? (
                  <div className={cn("mt-0.5 flex flex-wrap gap-1 px-1", m.mine ? "justify-end" : "justify-start")}>
                    {m.reactions.map((rx) => (
                      <button
                        key={rx.emoji}
                        type="button"
                        onClick={() => react(m.id, rx.emoji)}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
                          rx.mine ? "border-violet-500/50 bg-violet-500/10" : "border-border/60 bg-secondary/60",
                        )}
                      >
                        <span>{rx.emoji}</span>
                        {rx.count > 1 ? <span className="text-muted-foreground">{rx.count}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                <span className={cn("mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground")}>
                  {m.editedAt && !deleted ? <span>edited</span> : null}
                  {r ? (
                    <span className={cn("flex items-center gap-1 font-medium", r.read ? "text-primary" : "text-muted-foreground")}>
                      {r.delivered ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                      {r.label}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>

      {replyingTo || editingId ? (
        <div className="flex items-center gap-2 border-t border-border/60 bg-secondary/40 px-4 py-2 text-xs">
          {editingId ? <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" /> : <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="font-semibold text-foreground">{editingId ? "Editing message" : "Replying"}</span>
            {replyingTo ? ` · ${replyingTo.deletedAt ? "Deleted message" : replyingTo.body || "Message"}` : null}
          </span>
          <button type="button" onClick={cancelReplyOrEdit} aria-label="Cancel" className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

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

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition hover:bg-secondary",
        tone === "danger" ? "text-rose-500" : "text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
