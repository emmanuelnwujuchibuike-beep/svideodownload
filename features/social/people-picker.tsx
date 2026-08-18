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

export interface Group {
  /** Conversation id — a group has no single "other" user, so it's addressed
   *  by conversation, not by a member's user id (see ShareSheet's `toGroups`). */
  id: string;
  title: string;
  avatarUrl: string | null;
  memberCount: number;
}

// Recents + friends, module-cached briefly so reopening a sheet is instant.
let peopleCache: { at: number; people: Person[] } | null = null;

/**
 * Smart Share Circle™ — recents-then-friends was a flat two-tier order with
 * no ranking WITHIN either tier. Friends are now sorted by relationship
 * strength (lib/social/share-circle.ts reusing the same privacy-reviewed
 * `relationshipStrength` scorer Part 4's repost ranking already reuses), so
 * a favourited best friend you haven't messaged in a week still ranks above
 * someone you happened to message once. Recent-conversation partners who
 * AREN'T mutual friends have no score to reuse yet — they keep their
 * existing recency order and simply sort after every scored friend, rather
 * than inventing a cross-category comparison. Scores are fetched alongside
 * (not blocking) the two existing calls — a slow/failed score fetch just
 * falls back to the pre-Part-6 flat order, never blocks the picker.
 */
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
  const [convRes, friendRes, scoreRes] = await Promise.allSettled([
    fetch("/api/messages").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/friends").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/share/circle").then((r) => (r.ok ? r.json() : null)),
  ]);
  if (convRes.status === "fulfilled" && convRes.value?.conversations) {
    for (const c of convRes.value.conversations as { other: Person | null }[]) add(c.other);
  }
  if (friendRes.status === "fulfilled" && friendRes.value?.friends) {
    for (const f of friendRes.value.friends as { user: Person }[]) add(f.user);
  }
  const scores: Record<string, number> =
    scoreRes.status === "fulfilled" ? ((scoreRes.value?.scores as Record<string, number>) ?? {}) : {};
  if (Object.keys(scores).length > 0) {
    // A stable sort (guaranteed by the spec since ES2019) keeps every
    // unscored person in their existing recency order relative to each
    // other — only scored friends get reordered, and only among themselves.
    people.sort((a, b) => (scores[b.id] ?? -1) - (scores[a.id] ?? -1));
  }
  peopleCache = { at: Date.now(), people };
  return people;
}

// Group conversations, module-cached the same way loadPeople() is.
let groupsCache: { at: number; groups: Group[] } | null = null;

export async function loadGroups(): Promise<Group[]> {
  if (groupsCache && Date.now() - groupsCache.at < 60_000) return groupsCache.groups;
  try {
    const res = await fetch("/api/messages");
    if (!res.ok) return [];
    const j = (await res.json()) as { conversations?: { id: string; type: string; title: string | null; avatarUrl: string | null; memberCount: number }[] };
    const groups = (j.conversations ?? [])
      .filter((c) => c.type === "group")
      .map((c) => ({ id: c.id, title: c.title ?? "Group", avatarUrl: c.avatarUrl, memberCount: c.memberCount }));
    groupsCache = { at: Date.now(), groups };
    return groups;
  } catch {
    return [];
  }
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
