"use client";

import { AlertTriangle, Loader2, Lock, Send, ShieldCheck, Timer } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BackToSecretChats } from "@/features/social/secret-chats-panel";
import { toast } from "@/features/ui/toast";
import { useAnchoredPanel } from "@/features/ui/use-anchored-panel";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { decryptFromConversation, encryptForConversation, ensureIdentityKey, fetchPublicKey } from "@/lib/crypto/secret-chat";

interface RawMessage {
  id: string;
  body: string;
  encryptionIv: string | null;
  createdAt: string;
  mine: boolean;
  deletedAt: string | null;
}

interface DecryptedMessage extends RawMessage {
  plaintext: string | null; // null = couldn't decrypt (no local key / corrupted)
}

const POLL_MS = 4000;

/**
 * Secret Chat thread (Part 11b) — real client-side E2E encryption (see
 * lib/crypto/secret-chat.ts). Deliberately simpler than the main
 * ConversationRoom: text only, no reactions/replies/typing indicators/
 * realtime channel — a lightweight poll against the SAME `/api/messages/:id`
 * delta-sync endpoint the main chat uses for its own catch-up path. This is
 * an honest v1 scope call given the size of a full E2EE messaging surface,
 * not an oversight.
 */
const TIMER_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Off", seconds: null },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

export function SecretChatRoom({
  conversationId,
  viewerId: _viewerId,
  other,
  initialMessages,
  initialSyncedAt,
  initialDisappearAfterSeconds,
}: {
  conversationId: string;
  viewerId: string;
  other: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  initialMessages: RawMessage[];
  initialSyncedAt: string;
  initialDisappearAfterSeconds: number | null;
}) {
  const [ready, setReady] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [disappearAfter, setDisappearAfter] = useState(initialDisappearAfterSeconds);
  const {
    triggerRef: timerButtonRef,
    open: timerOpen,
    setOpen: setTimerOpen,
    mounted: timerMounted,
    pos: timerPos,
    toggle: toggleTimer,
  } = useAnchoredPanel<HTMLButtonElement>(176);
  const otherKeyRef = useRef<CryptoKey | null>(null);
  const syncedAtRef = useRef(initialSyncedAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initialMessages.map((m) => m.id)));

  const decryptOne = async (m: RawMessage): Promise<DecryptedMessage> => {
    if (m.deletedAt) return { ...m, plaintext: null };
    if (!m.encryptionIv || !otherKeyRef.current) return { ...m, plaintext: null };
    const plaintext = await decryptFromConversation(otherKeyRef.current, { body: m.body, iv: m.encryptionIv });
    return { ...m, plaintext };
  };

  useEffect(() => {
    (async () => {
      try {
        await ensureIdentityKey();
        const key = await fetchPublicKey(other.id);
        if (!key) throw new Error("no key");
        otherKeyRef.current = key;
        const decrypted = await Promise.all(initialMessages.map(decryptOne));
        setMessages(decrypted);
        setReady(true);
      } catch {
        setKeyError(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  // Lightweight poll for new messages — see the component doc comment for
  // why this isn't a realtime channel in v1. `since` is a delta sync: it can
  // return rows the client already has whose `updated_at` moved (an edit, a
  // disappearing-message soft-delete) — not only brand-new ids. Those MUST
  // be merged into the existing entry (re-decrypted / re-rendered), not
  // dropped, or a message deleted by the disappearing-messages cron would
  // keep showing its old plaintext in an already-open thread forever.
  useEffect(() => {
    if (!ready) return;
    const tick = async () => {
      if (document.hidden) return; // paused while backgrounded — resyncs on visibilitychange below
      try {
        const res = await fetch(`/api/messages/${conversationId}?since=${encodeURIComponent(syncedAtRef.current)}`);
        const json = await res.json();
        if (!res.ok) return;
        syncedAtRef.current = json.syncedAt;
        const rows = json.messages as RawMessage[];
        if (rows.length === 0) return;
        const newlyArrived = rows.filter((m) => !seen.current.has(m.id));
        for (const m of rows) seen.current.add(m.id);
        const decrypted = await Promise.all(rows.map(decryptOne));
        setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          for (const m of decrypted) byId.set(m.id, m);
          return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
        if (newlyArrived.some((m) => !m.mine)) {
          haptic("light");
          playSound("tap");
        }
      } catch {
        /* best-effort — retried on the next tick */
      }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- otherKeyRef/syncedAtRef are refs, conversationId is stable per mount
  }, [ready]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending || !otherKeyRef.current) return;
    setSending(true);
    haptic("light");
    playSound("tap");
    try {
      const enc = await encryptForConversation(otherKeyRef.current, text);
      const clientId = crypto.randomUUID();
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, body: enc.body, encryptionIv: enc.iv, clientId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error();
      setBody("");
      const now = new Date().toISOString();
      seen.current.add(json.id);
      setMessages((prev) => [...prev, { id: json.id, body: enc.body, encryptionIv: enc.iv, createdAt: now, mine: true, deletedAt: null, plaintext: text }]);
    } catch {
      /* left in the composer — the user can retry the send */
    } finally {
      setSending(false);
    }
  };

  const setTimer = async (seconds: number | null) => {
    setTimerOpen(false);
    const prev = disappearAfter;
    setDisappearAfter(seconds);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disappearAfterSeconds: seconds }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setDisappearAfter(prev);
      toast("Couldn't update disappearing messages.", "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:flex-1">
      <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3">
        <BackToSecretChats />
        {other.avatarUrl ? (
          <Image src={other.avatarUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
            {other.displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{other.displayName}</p>
          <p className="flex items-center gap-1 text-xs text-emerald-500">
            <ShieldCheck className="h-3 w-3" /> End-to-end encrypted
          </p>
        </div>
        <div className="relative">
          <button
            ref={timerButtonRef}
            type="button"
            onClick={toggleTimer}
            aria-label="Disappearing messages"
            title="Disappearing messages"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${disappearAfter ? "text-emerald-500" : "text-muted-foreground hover:bg-secondary/60"}`}
          >
            <Timer className="h-4 w-4" />
          </button>
          {/* This header sits inside the fixed-inset thread overlay above — the
              same overflow/backdrop-blur containment class of ancestor that
              forced notification-settings-picker/presence-status-picker to
              portal — so this dropdown uses the same shared mechanism rather
              than reintroducing an un-portaled `absolute` panel. */}
          {timerOpen && timerMounted && timerPos
            ? createPortal(
                <>
                  <button type="button" aria-label="Close" onClick={() => setTimerOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <div
                    className="animate-scale-in fixed z-50 w-44 overflow-hidden rounded-2xl border border-border/70 bg-card py-1 shadow-elevated"
                    style={{ top: timerPos.top, right: timerPos.right }}
                  >
                    {TIMER_OPTIONS.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => void setTimer(t.seconds)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-secondary"
                      >
                        {t.label}
                        {disappearAfter === t.seconds ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )
            : null}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {!ready ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : keyError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
            Couldn&apos;t set up encryption for this conversation — check your connection and reload.
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Lock className="h-6 w-6" />
            <p className="max-w-xs">
              Messages here are encrypted end-to-end — only visible on devices that were signed in when they were sent. There&apos;s no cloud
              backup, forwarding, or search for this chat.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[15px] ${
                  m.mine ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white" : "bg-secondary/60"
                }`}
              >
                {m.deletedAt ? (
                  <span className="italic opacity-70">Message deleted</span>
                ) : m.plaintext === null ? (
                  <span className="flex items-center gap-1.5 italic opacity-70">
                    <AlertTriangle className="h-3.5 w-3.5" /> Can&apos;t decrypt on this device
                  </span>
                ) : (
                  m.plaintext
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-border/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-1 items-center gap-2 rounded-full bg-secondary/50 px-4 py-2.5">
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Encrypted message…"
            disabled={!ready || keyError}
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          type="submit"
          disabled={!body.trim() || sending || !ready || keyError}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      <p className="flex items-center justify-center gap-1 border-t border-border/40 py-1.5 text-[10px] text-muted-foreground">
        <Timer className="h-3 w-3" /> No forwarding, no search, no cloud backup for this chat
      </p>
    </div>
  );
}
