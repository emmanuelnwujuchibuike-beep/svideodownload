"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, Loader2, UserPlus, X } from "lucide-react";
import { IoPersonAddOutline, IoSparkles } from "react-icons/io5";
import Link from "next/link";
import { useCallback, useState } from "react";

import type { SuggestedCreator } from "@/lib/social/suggest";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Add-friends / Suggestions launcher — opens a bottom sheet of "people you may
 * know" (nearby/relevant creators) with instant follow.
 *
 * `variant="icon"` (default now) renders a single top-nav icon so it lives at the
 * very top, level with search / the profile menu — never a pill below the bar.
 * `variant="pill"` keeps the older labelled button for legacy spots.
 */
export function SuggestionsLauncher({
  className,
  variant = "icon",
}: {
  className?: string;
  variant?: "icon" | "pill";
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SuggestedCreator[] | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (list) return;
    try {
      const res = await fetch("/api/suggestions");
      const j = (await res.json()) as { suggestions: SuggestedCreator[] };
      setList(j.suggestions ?? []);
    } catch {
      setList([]);
    }
  }, [list]);

  const openSheet = () => {
    setOpen(true);
    void load();
  };

  const follow = async (id: string) => {
    const has = following.has(id);
    setFollowing((s) => {
      const n = new Set(s);
      has ? n.delete(id) : n.add(id);
      return n;
    });
    try {
      const res = await fetch(`/api/follow/${id}`, { method: has ? "DELETE" : "POST" });
      if (!res.ok) throw new Error();
    } catch {
      setFollowing((s) => {
        const n = new Set(s);
        has ? n.add(id) : n.delete(id);
        return n;
      });
    }
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={openSheet}
          aria-label="Add friends"
          title="Add friends"
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary active:scale-95",
            className,
          )}
        >
          <IoPersonAddOutline className="h-[20px] w-[20px]" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openSheet}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3.5 py-2 text-sm font-semibold text-foreground shadow-soft backdrop-blur transition hover:border-primary/40 active:scale-95",
            className,
          )}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white">
            <UserPlus className="h-3 w-3" />
          </span>
          Add friends
        </button>
      )}

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" onClick={() => setOpen(false)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
              className="relative m-3 max-h-[75vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border/60 bg-card/95 p-4 shadow-elevated backdrop-blur-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
                    <IoSparkles className="h-4 w-4" />
                  </span>
                  People you may know
                </h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {list === null ? (
                <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : list.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No suggestions right now — check back soon.</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((s) => {
                    const isFollowing = following.has(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-3 rounded-2xl px-2 py-1.5 transition hover:bg-secondary/50">
                        <Link href={`/u/${s.handle}`} onClick={() => setOpen(false)} className="shrink-0">
                          {s.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-border/50" />
                          ) : (
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-base font-bold text-white">{s.displayName.charAt(0).toUpperCase()}</span>
                          )}
                        </Link>
                        <Link href={`/u/${s.handle}`} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 text-sm font-semibold">
                            <span className="truncate">{s.displayName}</span>
                            {s.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">@{s.handle} · {formatCompactNumber(s.followersCount)} followers</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => follow(s.id)}
                          className={cn(
                            "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition active:scale-95",
                            isFollowing ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/30",
                          )}
                        >
                          {isFollowing ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Following</span> : "Follow"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
