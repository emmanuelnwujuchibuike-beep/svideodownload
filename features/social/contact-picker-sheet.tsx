"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { loadPeople, type Person } from "@/features/social/people-picker";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";

/**
 * Single-select "share a contact" sheet — reuses `loadPeople()` (recent
 * chats + friends, the same recipient source ShareSheet/CreateGroupSheet
 * already draw from) rather than a native OS contact picker (inconsistent
 * browser support; this also only lets you share someone who's actually a
 * Frenz contact, which is the only "contact" this app can meaningfully
 * represent — a real phone number/email isn't data this app has).
 */
export function ContactPickerSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (person: Person) => void }) {
  const [mounted, setMounted] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) void loadPeople().then(setPeople);
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

  const filtered = useMemo(() => {
    if (!people) return [];
    const query = q.trim().toLowerCase();
    if (!query) return people;
    return people.filter((p) => p.displayName.toLowerCase().includes(query) || p.handle.toLowerCase().includes(query));
  }, [people, q]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Share a contact">
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
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[80vh] w-full max-w-lg overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Share a contact</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 pb-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search friends"
                  className="w-full rounded-full bg-secondary/50 py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            </div>
            <div className="max-h-[50vh] space-y-0.5 overflow-y-auto px-3 pb-5">
              {people === null ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">No one matches that search.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      haptic("light");
                      onPick(p);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-secondary/40"
                  >
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                        {p.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{p.handle}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
