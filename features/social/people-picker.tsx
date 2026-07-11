"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import Image from "next/image";
import { useMemo } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Shared "who do I send/add this to" picker — search + multi-select avatar
 * grid. Originally lived only inside ShareSheet; extracted so CreateGroupSheet
 * (and any future picker) reuses the exact same recipient source and UI
 * instead of a copy-pasted grid.
 */

export interface Person {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

// Recents + friends, module-cached briefly so reopening a sheet is instant.
let peopleCache: { at: number; people: Person[] } | null = null;

export async function loadPeople(): Promise<Person[]> {
  if (peopleCache && Date.now() - peopleCache.at < 60_000) return peopleCache.people;
  const seenIds = new Set<string>();
  const people: Person[] = [];
  const add = (p: Person | null | undefined) => {
    if (p?.id && p.handle && !seenIds.has(p.id)) {
      seenIds.add(p.id);
      people.push(p);
    }
  };
  // Recent chats first (most likely recipients), then friends.
  const [convRes, friendRes] = await Promise.allSettled([
    fetch("/api/messages").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/friends").then((r) => (r.ok ? r.json() : null)),
  ]);
  if (convRes.status === "fulfilled" && convRes.value?.conversations) {
    for (const c of convRes.value.conversations as { other: Person | null }[]) add(c.other);
  }
  if (friendRes.status === "fulfilled" && friendRes.value?.friends) {
    for (const f of friendRes.value.friends as { user: Person }[]) add(f.user);
  }
  peopleCache = { at: Date.now(), people };
  return people;
}

export function PeoplePickerGrid({
  people,
  query,
  selected,
  onToggle,
  max = 24,
  emptyHint = "Add friends to get started.",
}: {
  /** `null` while loading (renders a shimmer grid). */
  people: Person[] | null;
  query: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  max?: number;
  emptyHint?: string;
}) {
  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.displayName.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q));
  }, [people, query]);

  const toggle = (id: string) => {
    onToggle(id);
    haptic("light");
  };

  if (people === null) {
    return (
      <div className="grid grid-cols-4 gap-3 py-1" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-14 w-14 rounded-full bg-secondary shimmer" />
            <div className="h-2.5 w-12 rounded bg-secondary shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{people.length === 0 ? emptyHint : "No one matches that search."}</p>;
  }

  return (
    <div className="grid grid-cols-4 gap-3 py-1">
      {filtered.slice(0, max).map((p) => {
        const on = selected.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => toggle(p.id)}
            aria-pressed={on}
            aria-label={`Select ${p.displayName}`}
            className="group flex flex-col items-center gap-1.5"
          >
            <span className={cn("relative rounded-full p-[2px] transition", on ? "bg-gradient-to-br from-blue-600 to-violet-600" : "bg-transparent")}>
              {p.avatarUrl ? (
                <Image src={p.avatarUrl} alt="" width={56} height={56} className="h-14 w-14 rounded-full object-cover ring-2 ring-card" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white ring-2 ring-card">
                  {p.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <AnimatePresence>
                {on ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 24 }}
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-card"
                  >
                    <Check className="h-3 w-3" strokeWidth={3.5} />
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
            <span className="max-w-[4.5rem] truncate text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
              {p.displayName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
