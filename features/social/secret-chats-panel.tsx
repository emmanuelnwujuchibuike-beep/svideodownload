"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, KeyRound, Loader2, Lock, Plus, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { timeAgo } from "@/features/notifications/meta";
import { toast } from "@/features/ui/toast";
import { ensureIdentityKey } from "@/lib/crypto/secret-chat";

interface SecretConversation {
  id: string;
  other: { id: string; handle: string; displayName: string; avatarUrl: string | null } | null;
  lastAt: string;
}

interface FriendOption {
  user: { id: string; handle: string; displayName: string; avatarUrl: string | null };
}

/**
 * Secret Chats list (Part 11b). Requires a PIN to already be set — without
 * one, "Hidden Chat" would have zero actual protection once someone is
 * already signed in on the device, defeating the whole point. Sets up this
 * device's encryption identity key on mount (a no-op after the first time).
 */
export function SecretChatsPanel() {
  const router = useRouter();
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [conversations, setConversations] = useState<SecretConversation[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState<FriendOption[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/app/security/pin/status")
      .then((r) => r.json())
      .then((json) => setHasPin(!!json.ok && json.data.hasPin))
      .catch(() => setHasPin(false));
  }, []);

  useEffect(() => {
    if (hasPin !== true) return;
    ensureIdentityKey()
      .then(() => setReady(true))
      .catch(() => setKeyError(true));
  }, [hasPin]);

  const load = () => {
    fetch("/api/messages/secret")
      .then((r) => r.json())
      .then((json) => setConversations(json.conversations ?? []))
      .catch(() => setConversations([]));
  };

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  const openPicker = () => {
    setPickerOpen(true);
    if (!friends) {
      fetch("/api/friends")
        .then((r) => r.json())
        .then((json) => setFriends((json.friends ?? []).map((f: { user: FriendOption["user"] }) => ({ user: f.user }))))
        .catch(() => setFriends([]));
    }
  };

  const startChat = async (recipientId: string) => {
    setStarting(recipientId);
    try {
      const res = await fetch("/api/messages/secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Couldn't start a Secret Chat.");
      setPickerOpen(false);
      router.push(`/messages/secret/${json.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start a Secret Chat.", "error");
    } finally {
      setStarting(null);
    }
  };

  if (hasPin === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasPin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lock className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">Set up a PIN to use Secret Chats</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Secret Chats are end-to-end encrypted and stay hidden behind your quick-lock PIN — set one up first.
        </p>
        <Link
          href="/account/security"
          className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25"
        >
          <KeyRound className="h-4 w-4" /> Set up a PIN
        </Link>
      </div>
    );
  }

  if (keyError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Couldn&apos;t set up encryption on this device. Check your connection and reload.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
            <ShieldCheck className="h-6 w-6 text-emerald-500" /> Secret Chats
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">End-to-end encrypted — not even Frenzsave can read these.</p>
        </div>
        <button
          type="button"
          onClick={openPicker}
          aria-label="New Secret Chat"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/60 transition hover:bg-secondary"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {!ready || conversations === null ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up encryption…
        </div>
      ) : conversations.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">No Secret Chats yet. Start one above.</p>
      ) : (
        <div className="space-y-1">
          {conversations.map((c) =>
            c.other ? (
              <Link
                key={c.id}
                href={`/messages/secret/${c.id}`}
                className="flex items-center gap-3 rounded-2xl p-3 transition hover:bg-secondary/50"
              >
                {c.other.avatarUrl ? (
                  <Image src={c.other.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white">
                    {c.other.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.other.displayName}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" /> Encrypted message
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.lastAt)} ago</span>
              </Link>
            ) : null,
          )}
        </div>
      )}

      {pickerOpen && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40"
              >
                <button type="button" aria-label="Close" onClick={() => setPickerOpen(false)} className="absolute inset-0" />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="relative z-10 max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Start a Secret Chat</h2>
                    <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close" className="text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {friends === null ? (
                    <div className="flex h-20 items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : friends.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Add friends first to start a Secret Chat.</p>
                  ) : (
                    <div className="space-y-1">
                      {friends.map((f) => (
                        <button
                          key={f.user.id}
                          type="button"
                          onClick={() => startChat(f.user.id)}
                          disabled={starting !== null}
                          className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-secondary/50 disabled:opacity-50"
                        >
                          {f.user.avatarUrl ? (
                            <Image src={f.user.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                              {f.user.displayName.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.user.displayName}</span>
                          {starting === f.user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Small back-link used by the thread page's header. */
export function BackToSecretChats() {
  return (
    <Link href="/messages/secret" aria-label="Back to Secret Chats" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary/60">
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}
