"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, UserCheck, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { FriendCelebration } from "./friend-celebration";

/**
 * Friend request lifecycle on a profile (Frenz Connect): Add Friend → premium
 * request modal (optional ≤150-char note) → Requested (two-step cancel) →
 * Accept/Decline for incoming → Friends (two-step unfriend). Accepting fires
 * the glass celebration card with Start Chat. Optimistic; reverts on error.
 */

export type FriendState = "none" | "outgoing" | "incoming" | "friends";

const NOTE_MAX = 150;

export function AddFriendButton({
  targetId,
  targetName,
  targetHandle,
  targetAvatarUrl,
  mutualCount = 0,
  initialState,
  className,
}: {
  targetId: string;
  targetName: string;
  targetHandle: string;
  targetAvatarUrl?: string | null;
  mutualCount?: number;
  initialState: FriendState;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<FriendState>(initialState);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  // Two-step destructive actions ("Cancel request?" / "Remove friend?") — arms
  // for 3s instead of popping a dialog.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  const arm = () => {
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };

  const post = async (body: { action: string; note?: string }) => {
    const res = await fetch(`/api/friends/${targetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res;
  };

  const respond = async (action: "accept" | "decline") => {
    if (busy) return;
    setBusy(true);
    const prev = state;
    setState(action === "accept" ? "friends" : "none");
    try {
      const res = await post({ action });
      if (!res.ok) setState(prev);
      else if (action === "accept") setCelebrate(true);
      router.refresh();
    } catch {
      setState(prev);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!armed) {
      arm();
      return;
    }
    setArmed(false);
    setBusy(true);
    const prev = state;
    setState("none");
    try {
      const res = await fetch(`/api/friends/${targetId}`, { method: "DELETE" });
      if (!res.ok) setState(prev);
      router.refresh();
    } catch {
      setState(prev);
    } finally {
      setBusy(false);
    }
  };

  const base =
    "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60";

  return (
    <>
      {state === "none" ? (
        <button
          type="button"
          onClick={() => setModal(true)}
          className={cn(
            base,
            "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:opacity-95",
            className,
          )}
        >
          <UserPlus className="h-4 w-4" /> Add Friend
        </button>
      ) : state === "outgoing" ? (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className={cn(
            base,
            armed
              ? "border border-rose-500/50 bg-rose-500/10 text-rose-500"
              : "border border-border bg-card text-foreground hover:bg-secondary",
            className,
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : armed ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {armed ? "Cancel request?" : "Requested"}
        </button>
      ) : state === "incoming" ? (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <button
            type="button"
            onClick={() => respond("accept")}
            disabled={busy}
            className={cn(base, "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:opacity-95")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />} Accept
          </button>
          <button
            type="button"
            onClick={() => respond("decline")}
            disabled={busy}
            className={cn(base, "border border-border bg-card text-muted-foreground hover:bg-secondary")}
          >
            Decline
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className={cn(
            base,
            armed
              ? "border border-rose-500/50 bg-rose-500/10 text-rose-500"
              : "border border-border bg-card text-foreground hover:bg-secondary",
            className,
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : armed ? <X className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          {armed ? "Remove friend?" : "Friends"}
        </button>
      )}

      <RequestModal
        open={modal}
        onClose={() => setModal(false)}
        targetName={targetName}
        targetHandle={targetHandle}
        targetAvatarUrl={targetAvatarUrl}
        mutualCount={mutualCount}
        onSend={async (note) => {
          const res = await post({ action: "request", note: note || undefined });
          if (res.ok) {
            setState("outgoing");
            return true;
          }
          // They already requested you — flip to Accept/Decline instead of erroring.
          if (res.status === 409) {
            setState("incoming");
            setModal(false);
          }
          return false;
        }}
      />

      <FriendCelebration
        open={celebrate}
        name={targetName}
        onStartChat={() => router.push(`/messages/new/${targetId}`)}
        onClose={() => setCelebrate(false)}
      />
    </>
  );
}

/** Glass request modal: identity, mutual friends, optional note, morphing send. */
function RequestModal({
  open,
  onClose,
  targetName,
  targetHandle,
  targetAvatarUrl,
  mutualCount,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  targetName: string;
  targetHandle: string;
  targetAvatarUrl?: string | null;
  mutualCount: number;
  onSend: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    if (open) {
      setNote("");
      setPhase("idle");
    }
  }, [open]);

  const send = async () => {
    if (phase !== "idle") return;
    setPhase("sending");
    const ok = await onSend(note.trim());
    if (ok) {
      setPhase("sent");
      setTimeout(onClose, 1100);
    } else {
      setPhase("error");
      setTimeout(() => setPhase("idle"), 1800);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Send friend request to ${targetName}`}
        >
          <motion.div
            initial={{ y: 48, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 48, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-5 shadow-elevated backdrop-blur-xl"
          >
            <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 blur-2xl" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3">
              {targetAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={targetAvatarUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-violet-500/30" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xl font-bold text-white">
                  {targetName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{targetName}</p>
                <p className="truncate text-sm text-muted-foreground">@{targetHandle}</p>
                {mutualCount > 0 ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {mutualCount} mutual friend{mutualCount === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-muted-foreground">
                Add a note <span className="opacity-70">(optional)</span>
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                rows={3}
                placeholder={`Hi! I'd love to connect.`}
                className="mt-1.5 w-full resize-none rounded-2xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
              />
              <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
                {note.length}/{NOTE_MAX}
              </span>
            </label>

            <button
              type="button"
              onClick={send}
              disabled={phase === "sending" || phase === "sent"}
              className={cn(
                "mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold text-white transition",
                phase === "sent"
                  ? "bg-emerald-500"
                  : phase === "error"
                    ? "bg-rose-500"
                    : "bg-gradient-to-r from-blue-600 to-violet-600 shadow-md shadow-violet-500/25 hover:opacity-95 disabled:opacity-70",
              )}
            >
              {phase === "sending" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : phase === "sent" ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                  <Check className="h-4 w-4" />
                </motion.span>
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {phase === "sent" ? "Request Sent" : phase === "error" ? "Couldn't send — try again" : "Send Request"}
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
