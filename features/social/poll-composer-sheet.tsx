"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";

const MAX_OPTIONS = 6;

/** Create-a-poll sheet (owner mockup completion) — question + 2-6 options,
 *  single-choice. Reuses the same bottom-sheet shell as MediaComposerSheet. */
export function PollComposerSheet({
  open,
  onClose,
  conversationId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onCreated: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      setQuestion("");
      setOptions(["", ""]);
    }
  }, [open]);
  // Body-scroll-lock convention (lib/dom/scroll-lock.ts) — was missing here.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  const submit = async () => {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2) {
      toast("Add a question and at least 2 options.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/messages/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, question: question.trim(), options: cleanOptions }),
      });
      if (res.ok) {
        onClose();
        onCreated();
      } else {
        toast("Couldn't create the poll.", "error");
      }
    } catch {
      toast("Couldn't create the poll — check your connection.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Create a poll">
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
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Create a poll</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 pb-6 pt-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question…"
                maxLength={300}
                className="w-full rounded-xl border border-border/60 bg-transparent px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={opt}
                      onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
                      placeholder={`Option ${i + 1}`}
                      maxLength={100}
                      className="w-full rounded-xl border border-border/60 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {options.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label="Remove option"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {options.length < MAX_OPTIONS ? (
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setOptions((prev) => [...prev, ""]);
                  }}
                  className="flex items-center gap-1.5 text-sm font-semibold text-primary"
                >
                  <Plus className="h-4 w-4" /> Add option
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="w-full rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                Create poll
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
