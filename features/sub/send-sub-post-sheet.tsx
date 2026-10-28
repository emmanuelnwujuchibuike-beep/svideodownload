"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The creator sends one of their exclusive posts into chats (0305 — owner, 2026-10-28). The message carries only the
  post id (metadata kind "sub_post", POST /api/messages checks the sender made the post); every viewer's card is gated
  on its own (features/sub/sub-post-chat-card.tsx): a subscriber sees the post, anyone else the blurred preview.
*/
type Target = { id: string; type: "direct" | "group"; title: string | null; avatarUrl: string | null; other: { displayName: string; avatarUrl: string | null } | null };

export function SendSubPostSheet({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || targets) return;
    void fetch("/api/messages", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { conversations?: Target[] } | null) => setTargets((j?.conversations ?? []).filter((c) => c.type === "direct" || c.type === "group")))
      .catch(() => setTargets([]));
  }, [open, targets]);

  const toggle = (id: string) => {
    haptic("selection");
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const send = async () => {
    if (!picked.size || sending) return;
    setSending(true);
    const results = await Promise.all(
      [...picked].map((conversationId) =>
        fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ conversationId, clientId: crypto.randomUUID(), clientSentAt: new Date().toISOString(), body: "Shared an exclusive post", metadata: { kind: "sub_post", postId } }),
        })
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    setSending(false);
    const ok = results.filter(Boolean).length;
    if (ok) {
      haptic("medium");
      toast(ok === 1 ? "Sent to 1 chat" : `Sent to ${ok} chats`, "success");
      setPicked(new Set());
      onClose();
    } else toast("Couldn't send it. Try again.", "error");
  };

  return (
    <GlassSheetShell open={open} onClose={onClose} title="Send to chats" defaultHeightVh={70} panelZ={140} backdropZ={139}>
      <div className="flex flex-col gap-3 px-4 pb-6">
        <p className="text-xs text-frenz-muted">Subscribers will see the post. Everyone else sees it blurred, with a Subscribe button.</p>
        {!targets ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-frenz-muted" aria-hidden />
          </div>
        ) : targets.length === 0 ? (
          <p className="py-6 text-center text-sm text-frenz-muted">No chats yet.</p>
        ) : (
          <ul className="flex flex-col">
            {targets.map((t) => {
              const name = t.type === "group" ? t.title || "Group chat" : t.other?.displayName || "Unknown";
              const avatar = t.type === "group" ? t.avatarUrl : (t.other?.avatarUrl ?? null);
              const on = picked.has(t.id);
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => toggle(t.id)} aria-pressed={on} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left transition active:bg-frenz-fill">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-frenz-fill text-sm font-bold">{name.replace(/^@/, "").charAt(0).toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{name}</span>
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2", on ? "border-transparent bg-frenz-gradient-x text-white" : "border-frenz-line")}>{on ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : null}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" disabled={!picked.size || sending} aria-busy={sending} onClick={() => void send()} className="flex h-12 items-center justify-center gap-2 rounded-full bg-frenz-gradient-x text-[15px] font-bold text-white shadow-frenz-card disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {picked.size > 1 ? `Send to ${picked.size} chats` : "Send"}
        </button>
      </div>
    </GlassSheetShell>
  );
}
