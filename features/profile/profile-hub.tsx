"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { HUB_GROUPS, HUB_META, type HubEntry, type HubKey } from "@/lib/profile/hub";
import { prefetchHubSection } from "@/lib/profile/hub-client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The modal — the sheet shell, the strip loader and every section's panel —
  is one lazy chunk, fetched the first time a button is pressed. The hub
  itself is the buttons and an IntersectionObserver: that is the whole cost
  the profile pays on landing.
*/
const ProfileHubModal = dynamic(() => import("@/features/profile/profile-hub-modal").then((m) => m.ProfileHubModal), { ssr: false });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROFILE HUB — every other section, as a button that opens a modal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "put all the cards in a button and they open as a
 * premium modal, all sections card except from the hero, experience mode and
 * media grid… to free up the profile landing budget and speed."
 *
 * What the landing document carries for each section is ONE button: a
 * glossy tile, a label and a short fact. Its data is read when the button
 * scrolls into view — one section at a time, through the queue in
 * lib/profile/hub-client.ts — or when it is tapped, in which case the modal
 * opens at once with a strip loader across its top until the answer lands.
 *
 * The buttons are premium and professional, not decorative: a two-column
 * grid on a phone, three on wider screens, each a 64px tap target with a
 * gradient tile in the section's own colour and a chevron, pressed with
 * the same haptic and scale the rest of the app uses.
 */
export function ProfileHub({ handle, entries, owner = false, className }: { handle: string; entries: HubEntry[]; owner?: boolean; className?: string }) {
  const [open, setOpen] = useState<HubKey | null>(null);
  const [mounted, setMounted] = useState(false);
  // the one group open under the row — none until a button is pressed
  const [group, setGroup] = useState<string | null>(null);

  const openKey = useCallback((key: HubKey) => {
    haptic("selection");
    setMounted(true);
    setOpen(key);
  }, []);
  const close = useCallback(() => setOpen(null), []);

  const byKey = new Map(entries.map((e) => [e.key, e]));
  const groups = HUB_GROUPS.map((g) => ({ ...g, rows: g.keys.map((k) => byKey.get(k)).filter((e): e is HubEntry => !!e) })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;

  /*
    Three small buttons in one row (owner, 2026-10-29: "put all these cards in 3 buttons that show on click, just like
    Multi-Link … small so the three fit in one row, and two shouldn't open at the same time"). Showcase, Insights and
    Only you each open their own card of rows under the row; opening one closes the other, and a second tap closes it.
    Each row still opens its section in the one lazy sheet, and still prefetches as it comes into view.
  */
  const shownGroup = groups.find((g) => g.id === group) ?? null;
  return (
    <section aria-label="More on this profile" className={cn("frenz-ui mt-6", className)}>
      <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-frenz-muted">More on this profile</h2>
      <div className="flex gap-2">
        {groups.map((g) => {
          const on = g.id === group;
          return (
            <button
              key={g.id}
              type="button"
              aria-expanded={on}
              aria-controls="profile-hub-group"
              onClick={() => {
                haptic("selection");
                setGroup(on ? null : g.id);
              }}
              className={cn(
                "flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[13px] font-bold transition active:scale-[0.97] motion-reduce:active:scale-100",
                on ? "border-frenz-ink bg-frenz-ink text-white dark:border-white dark:bg-white dark:text-frenz-ink" : "border-frenz-line bg-frenz-card text-frenz-ink hover:bg-frenz-fill",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-heading text-[10.5px] font-extrabold text-white",
                  g.id === "showcase" ? "bg-frenz-blue" : g.id === "insights" ? "bg-frenz-violet" : on ? "bg-white/20" : "bg-frenz-ink",
                )}
              >
                {g.mark}
              </span>
              <span className="truncate">{g.title}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none", on && "rotate-180")} aria-hidden />
            </button>
          );
        })}
      </div>
      <div id="profile-hub-group">
        {shownGroup ? (
          <div key={shownGroup.id} className="mt-3">
            {owner ? <p className="mb-2 px-1 text-xs text-frenz-muted">{shownGroup.ownerSub}</p> : null}
            <ul className="overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
              {shownGroup.rows.map((entry, i) => (
                <li key={entry.key} className={cn(i > 0 && "border-t border-frenz-line")}>
                  <HubButton handle={handle} entry={entry} onOpen={openKey} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {mounted ? <ProfileHubModal handle={handle} open={open} onClose={close} /> : null}
    </section>
  );
}

function HubButton({ handle, entry, onOpen }: { handle: string; entry: HubEntry; onOpen: (key: HubKey) => void }) {
  const meta = HUB_META[entry.key];
  const ref = useRef<HTMLButtonElement | null>(null);

  // Prefetch when the row is about to be seen — 160px before it enters the viewport — and only once.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          prefetchHubSection(handle, entry.key);
          io.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [handle, entry.key]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(entry.key)}
      className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-frenz-fill active:bg-frenz-fill"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold text-frenz-ink">{meta.label}</span>
        <span className={cn("truncate text-[13px]", entry.empty ? "text-frenz-muted/80" : "text-frenz-muted")}>{entry.sub ?? meta.blurb}</span>
      </span>
      {entry.empty ? (
        <span className="shrink-0 rounded-full bg-frenz-violet/10 px-3 py-1.5 text-[13px] font-bold text-frenz-violet">Add</span>
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
      )}
    </button>
  );
}
