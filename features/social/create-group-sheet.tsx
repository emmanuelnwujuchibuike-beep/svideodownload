"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { loadPeople, PeoplePickerGrid, type Person } from "@/features/social/people-picker";
import { toast } from "@/features/ui/toast";
import { GROUP_TITLE_MAX, MAX_GROUP_MEMBERS } from "@/lib/social/message-meta";

/** Bottom sheet: name a group + pick members (reuses the same people-picker as ShareSheet). */
export function CreateGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || people) return;
    let cancelled = false;
    void loadPeople().then((p) => {
      if (!cancelled) setPeople(p);
    });
    return () => {
      cancelled = true;
    };
  }, [open, people]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTitle("");
    setQuery("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || selected.size === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle, memberIds: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't create the group.", "error");
        return;
      }
      onClose();
      router.push(`/messages/${json.id}`);
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setCreating(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="New group">
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
            transition={{ type: "spring", stiffness: 420, damping: 42 }}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-2xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                <Users className="h-4 w-4 text-primary" /> New group
              </h2>
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
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, GROUP_TITLE_MAX))}
                placeholder="Group name"
                aria-label="Group name"
                className="w-full rounded-2xl bg-secondary px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="px-5 pb-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people"
                aria-label="Search people"
                className="w-full rounded-2xl bg-secondary px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-56 overflow-y-auto px-5 pb-2">
              <PeoplePickerGrid
                people={people}
                query={query}
                selected={selected}
                onToggle={toggle}
                max={MAX_GROUP_MEMBERS - 1}
                emptyHint="Add friends first to start a group."
              />
            </div>

            <div className="border-t border-border/60 px-5 py-4">
              <button
                type="button"
                onClick={create}
                disabled={creating || !title.trim() || selected.size === 0}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create group{selected.size > 0 ? ` · ${selected.size + 1}` : ""}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
