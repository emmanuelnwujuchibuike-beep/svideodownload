"use client";

import { PenSquare, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CreateGroupSheet } from "@/features/social/create-group-sheet";
import { loadPeople, PeoplePickerGrid, type Person } from "@/features/social/people-picker";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * "Compose" entry point — the owner's mockup shows a single pencil icon in
 * the inbox header for starting something new. Rather than drop the
 * existing "New group" launcher to make icon counts match, this offers
 * BOTH ways to start something new from that one pencil: pick a person to
 * jump straight into (or start) a direct conversation via the existing
 * `/messages/new/[id]` get-or-create route, or "New group" which opens the
 * same `CreateGroupSheet` the old dedicated button did. Reuses
 * `PeoplePickerGrid` as a single-select (tapping a person immediately
 * navigates instead of toggling a multi-select checkmark) rather than
 * duplicating its search/avatar-grid rendering.
 */
export function ComposeLauncher({ className, iconClassName = "h-[18px] w-[18px]", strokeWidth }: { className?: string; iconClassName?: string; strokeWidth?: number }) {
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  // Body-scroll-lock convention (lib/dom/scroll-lock.ts) — was missing here.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  // the people list starts loading on finger-DOWN (2026-10-08, owner: "respond instantly"),
  // so the sheet is usually full when it opens — one request, however it was started
  const peopleLoad = useRef<Promise<void> | null>(null);
  const primePeople = () => {
    if (people || peopleLoad.current) return;
    peopleLoad.current = loadPeople()
      .then(setPeople)
      .catch(() => {
        peopleLoad.current = null;
        setPeople([]);
      });
  };
  useEffect(() => {
    if (open) primePeople();
    // primePeople reads only refs and `people`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people]);

  const startDirect = (id: string) => {
    haptic("selection");
    setOpen(false);
    router.push(`/messages/new/${id}`);
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={primePeople}
        onClick={() => {
          haptic("light");
          setOpen(true);
        }}
        aria-label="New message"
        title="New message"
        // a caller's className is the whole look (the inbox's glass circle); the default is the plain icon button
        className={className ? cn("flex shrink-0 items-center justify-center", className) : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"}
      >
        <PenSquare className={iconClassName} strokeWidth={strokeWidth} aria-hidden />
      </button>

      {open
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              />
              <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-border/70 bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-elevated">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-bold">New message</h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setOpen(false);
                    setGroupOpen(true);
                  }}
                  className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-border/70 p-3 text-left transition hover:bg-secondary"
                >
                  {/* No tile behind the glyph (owner, 2026-07-16: icons are
                      bare, high-contrast, WhatsApp/iOS style — no colored
                      block). */}
                  <span className="flex h-10 w-10 items-center justify-center text-foreground">
                    <UsersRound className="h-[22px] w-[22px]" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">New group</span>
                    <span className="block text-xs text-muted-foreground">Message multiple people at once</span>
                  </span>
                </button>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people"
                  aria-label="Search people"
                  className="mb-3 w-full rounded-full bg-secondary/60 px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-violet-500/30"
                />
                <PeoplePickerGrid people={people} query={query} selected={new Set()} onToggle={startDirect} emptyHint="Add friends to start messaging." />
              </div>
            </>,
            document.body,
          )
        : null}
      <CreateGroupSheet open={groupOpen} onClose={() => setGroupOpen(false)} />
    </>
  );
}
