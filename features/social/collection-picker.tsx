"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, FolderPlus, Globe, Loader2, Lock, Plus, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

type Vis = "public" | "followers" | "private";
interface Row {
  id: string;
  name: string;
  visibility: Vis;
  count: number;
  contains: boolean;
}

const VIS_META: Record<Vis, { icon: typeof Lock; label: string }> = {
  private: { icon: Lock, label: "Private" },
  followers: { icon: Users, label: "Followers" },
  public: { icon: Globe, label: "Public" },
};

/**
 * "Save to collection" — a premium bottom sheet to toggle a post in/out of the
 * viewer's collections and spin up a new one on the spot. Portaled to <body> so it
 * floats above the app nav. Optimistic toggles; best-effort before migration 0027.
 */
export function CollectionPicker({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [vis, setVis] = useState<Vis>("private");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const busy = useRef<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCreating(false);
    setName("");
    setQuery("");
    fetch(`/api/collections?post=${postId}`)
      .then((r) => (r.ok ? r.json() : { collections: [] }))
      .then((d) => setRows((d.collections ?? []) as Row[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, postId]);

  const toggle = async (row: Row) => {
    if (busy.current.has(row.id)) return;
    busy.current.add(row.id);
    const next = !row.contains;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, contains: next, count: r.count + (next ? 1 : -1) } : r)));
    try {
      const res = await fetch(`/api/collections/${row.id}/items`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, contains: !next, count: r.count + (next ? -1 : 1) } : r)));
      toast("Couldn't update the collection.", "error");
    } finally {
      busy.current.delete(row.id);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, visibility: vis }),
      });
      const d = await res.json();
      if (!res.ok || !d.collection) throw new Error(d.error);
      // Add the post to the new collection immediately.
      await fetch(`/api/collections/${d.collection.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      setRows((rs) => [{ id: d.collection.id, name: trimmed, visibility: vis, count: 1, contains: true }, ...rs]);
      setCreating(false);
      setName("");
      setVis("private");
      toast(`Saved to “${trimmed}”.`, "success");
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't create the collection.", "error");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="text-sm font-bold">Save to collection</h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search — only worth the space once there's actually enough to
                search through; a couple of collections don't need it. */}
            {rows.length > 5 ? (
              <div className="px-5 pb-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search collections…"
                    aria-label="Search collections"
                    className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-foreground/30"
                  />
                </div>
              </div>
            ) : null}

            <div className="max-h-[52vh] overflow-y-auto px-2.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : rows.length === 0 && !creating ? (
                <div className="px-3 py-8 text-center">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                    <FolderPlus className="h-6 w-6" />
                  </span>
                  <p className="text-sm text-muted-foreground">No collections yet — create your first.</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                    <Search className="h-6 w-6" />
                  </span>
                  <p className="text-sm text-muted-foreground">No collections match “{query.trim()}”.</p>
                </div>
              ) : (
                filtered.map((r) => {
                  const V = VIS_META[r.visibility].icon;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(r)}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-secondary/60 active:scale-[0.99]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                        <FolderPlus className="h-5 w-5" strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.name}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <V className="h-3 w-3" /> {VIS_META[r.visibility].label} · {r.count}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition",
                          r.contains ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-transparent",
                        )}
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Create new */}
            <div className="border-t border-border/60 p-2.5">
              {creating ? (
                <div className="rounded-2xl bg-secondary/40 p-3">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="Collection name"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                    onKeyDown={(e) => e.key === "Enter" && create()}
                  />
                  <div className="mt-2.5 flex items-center gap-1 rounded-xl bg-background p-0.5 ring-1 ring-inset ring-border">
                    {(["private", "followers", "public"] as Vis[]).map((v) => {
                      const V = VIS_META[v].icon;
                      const on = vis === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setVis(v)}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                            on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <V className="h-3.5 w-3.5" /> {VIS_META[v].label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={() => setCreating(false)} className="flex-1 rounded-xl bg-secondary/70 py-2.5 text-sm font-semibold transition hover:bg-secondary">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={create}
                      disabled={!name.trim() || saving}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition hover:bg-secondary/60 active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Plus className="h-5 w-5" />
                  </span>
                  New collection
                </button>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
