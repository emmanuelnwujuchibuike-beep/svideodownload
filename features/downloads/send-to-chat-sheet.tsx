"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { readImageDimensions, readVideoMetadata } from "@/lib/media/message-attachments-client";
import { haptic, hapticPattern } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { presignUpload, uploadWithPlan, type UploadPlan } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

interface ChatTarget {
  id: string;
  type: "direct" | "group";
  title: string | null;
  avatarUrl: string | null;
  other: { displayName: string; avatarUrl: string | null } | null;
}

let targetsCache: { at: number; targets: ChatTarget[] } | null = null;
async function loadTargets(): Promise<ChatTarget[]> {
  if (targetsCache && Date.now() - targetsCache.at < 60_000) return targetsCache.targets;
  try {
    const res = await fetch("/api/messages");
    const json = res.ok ? await res.json() : null;
    const raw = (json?.conversations ?? []) as ChatTarget[];
    const targets = raw.map((c) => ({ id: c.id, type: c.type, title: c.title, avatarUrl: c.avatarUrl, other: c.other }));
    targetsCache = { at: Date.now(), targets };
    return targets;
  } catch {
    return [];
  }
}
function targetLabel(t: ChatTarget): string {
  return t.type === "group" ? t.title || "Group chat" : t.other?.displayName || "Unknown";
}
function targetAvatarUrl(t: ChatTarget): string | null {
  return t.type === "group" ? t.avatarUrl : (t.other?.avatarUrl ?? null);
}

/**
 * "Send to chat" for a just-downloaded file (owner spec 4b: "users should be
 * able send audio they downloaded and videos they downloaded"). Reuses the
 * EXACT publish pipeline download-player.tsx's own "Publish to everyone"
 * already uses — the file is already a real Blob in the browser by the time
 * this is reachable (no re-download, no server ever touching raw bytes):
 * upload once via presign+PUT, then attach the resulting URL to a message
 * per selected conversation. Conversation-picker UI mirrors ForwardSheet's
 * (same underlying data — the user's own conversations), duplicated rather
 * than generalized since the two sheets' send actions are different enough
 * (upload-then-attach vs. forward-an-existing-message) that sharing more
 * than the list UI would tangle two unrelated flows together.
 */
export function SendToChatSheet({
  open,
  onClose,
  blob,
  resolveBlob,
  kind,
  title,
  thumbnailUrl,
  prefetchedPlan,
}: {
  open: boolean;
  onClose: () => void;
  blob: Blob | null;
  /** Lazy fallback for when `blob` isn't populated yet (the caller's ref is
   *  only filled once the player has fully buffered). Resolves from the local
   *  media cache. See send(). */
  resolveBlob?: () => Promise<Blob | null>;
  kind: "video" | "audio" | "image";
  title: string;
  thumbnailUrl: string | null;
  prefetchedPlan?: UploadPlan | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [targets, setTargets] = useState<ChatTarget[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || targets) return;
    let cancelled = false;
    void loadTargets().then((t) => {
      if (!cancelled) setTargets(t);
    });
    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery("");
    setSentCount(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets ?? [];
    return (targets ?? []).filter((t) => targetLabel(t).toLowerCase().includes(q));
  }, [targets, query]);

  const toggle = (id: string) => {
    haptic("light");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (selected.size === 0 || sending) return;

    // Resolve the bytes HERE rather than trusting the `blob` prop.
    //
    // Owner report (2026-07-16): "when I try to send a download to someone on
    // chat" — nothing happened. This function used to open with
    // `|| !blob) return;`, a SILENT no-op: the caller passes
    // `blob={blobRef.current}`, and that ref is only populated once the player
    // has fully buffered the file. Tap Send before that (or on a download from
    // an earlier session whose player never streamed it) and the button did
    // absolutely nothing — no send, no error, no explanation.
    //
    // `resolveBlob` falls back to the local media cache (IndexedDB), which is
    // where every completed download already lives, so the common case now just
    // works. If the bytes genuinely aren't available we SAY so instead of
    // failing silently.
    setSending(true);
    try {
      const data = blob ?? (await resolveBlob?.() ?? null);
      if (!data) {
        toast("That file isn't ready yet — open it once, then try again.", "error");
        return;
      }
      const ext = kind === "audio" ? "mp3" : kind === "image" ? "jpg" : "mp4";
      const contentType = data.type || (kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/jpeg" : "video/mp4");
      const mediaUrl = prefetchedPlan
        ? await uploadWithPlan(prefetchedPlan, data, contentType).catch(async () => uploadWithPlan(await presignUpload(kind, ext), data, contentType))
        : await uploadWithPlan(await presignUpload(kind, ext), data, contentType);

      let mediaWidth: number | undefined;
      let mediaHeight: number | undefined;
      let durationMs: number | undefined;
      if (kind === "image") {
        const dims = await readImageDimensions(data as File);
        if (dims) ({ width: mediaWidth, height: mediaHeight } = dims);
      } else if (kind === "video") {
        const meta = await readVideoMetadata(data as File);
        if (meta) ({ width: mediaWidth, height: mediaHeight, durationMs } = meta);
      }

      const attachment = { mediaKind: kind, mediaUrl, thumbnailUrl: thumbnailUrl ?? undefined, mediaWidth, mediaHeight, durationMs, filename: title, mimeType: contentType };
      let sent = 0;
      for (const conversationId of selected) {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, body: "", attachments: [attachment] }),
        });
        if (res.ok) sent += 1;
      }
      if (sent === 0) {
        toast("Couldn't send.", "error");
        return;
      }
      setSentCount(sent);
      hapticPattern([10, 40, 10]);
      setTimeout(onClose, 950);
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="Send to chat">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <AnimatePresence>
              {sentCount !== null ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card"
                >
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg"
                  >
                    <Check className="h-8 w-8" strokeWidth={3} />
                  </motion.span>
                  <p className="text-sm font-semibold">
                    Sent to {sentCount} {sentCount === 1 ? "chat" : "chats"}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Send to chat</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats"
                  aria-label="Search chats"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto px-2 pb-2">
              {targets === null ? (
                <div className="space-y-1 px-3 py-1" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <div className="h-11 w-11 rounded-full bg-secondary shimmer" />
                      <div className="h-3 w-32 rounded bg-secondary shimmer" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {targets.length === 0 ? "No conversations yet." : "No chats match that search."}
                </p>
              ) : (
                filtered.map((t) => {
                  const on = selected.has(t.id);
                  const label = targetLabel(t);
                  const avatarUrl = targetAvatarUrl(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      aria-pressed={on}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-secondary/60"
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                          {label.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                          on ? "border-violet-500 bg-brand text-white" : "border-border/60 text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <AnimatePresence initial={false}>
              {selected.size > 0 ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border/60"
                >
                  <div className="flex items-center justify-end px-5 py-3">
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={sending}
                      className="bg-brand flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-60"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {sending ? "Sending…" : `Send${selected.size > 1 ? ` · ${selected.size}` : ""}`}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
