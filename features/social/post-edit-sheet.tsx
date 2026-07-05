"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

type Vis = "public" | "followers" | "private";

/**
 * Inline post editor — a bottom sheet a creator can open from anywhere their post
 * appears (feed card, reel), so editing the caption / visibility or deleting never
 * bounces them to a separate page. Talks to PATCH/DELETE /api/posts/:id (RLS
 * enforces ownership).
 */
export function PostEditSheet({
  item,
  open,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: { id: string; title?: string; visibility?: Vis };
  open: boolean;
  onClose: () => void;
  onSaved?: (patch: { title: string }) => void;
  onDeleted?: () => void;
}) {
  const [caption, setCaption] = useState(item.title ?? "");
  const [vis, setVis] = useState<Vis>(item.visibility ?? "public");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: caption.trim(), visibility: vis }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast(d.error ?? "Couldn't save.", "error");
        return;
      }
      toast("Changes saved", "success");
      onSaved?.({ title: caption.trim() });
      onClose();
    } catch {
      toast("Couldn't save.", "error");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast("Couldn't delete.", "error");
        return;
      }
      toast("Post deleted", "success");
      onDeleted?.();
      onClose();
    } catch {
      toast("Couldn't delete.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="Close editor"
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-x-0 bottom-0 z-[95] mx-auto max-w-lg rounded-t-3xl border-t border-border/60 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Edit post</h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mt-3 block text-xs font-semibold text-muted-foreground">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Write a caption…"
              className="mt-1 w-full resize-none rounded-2xl bg-secondary/60 p-3 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-primary"
            />

            <label className="mt-3 block text-xs font-semibold text-muted-foreground">Who can see this</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["public", "followers", "private"] as Vis[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVis(v)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs font-semibold capitalize transition",
                    vis === v ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2">
              {confirmDel ? (
                <>
                  <button type="button" onClick={del} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" /> Delete for good
                  </button>
                  <button type="button" onClick={() => setConfirmDel(false)} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold">Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirmDel(true)} disabled={busy} aria-label="Delete post" className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-red-500 transition hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save changes
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
