"use client";

import { ChevronRight } from "lucide-react";
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
    Three iOS lists (ProfileExclusive.dc.html, 2026-10-18): Showcase, Insights and Only you, each a white
    card of rows under a small titled header; an owner's empty section says "Add" instead of "Nothing here
    yet". Appearance is in Settings now and is not listed. Each row still opens its section in the one lazy
    sheet, and still prefetches as it comes into view.
  */
  return (
    <section aria-label="More on this profile" className={cn("frenz-ui mt-6", className)}>
      <h2 className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-frenz-muted">More on this profile</h2>
      {groups.map((g) => (
        <div key={g.id} className="mt-3">
          <div className="mb-2 flex items-center gap-2.5 px-1">
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg font-heading text-[13px] font-extrabold text-white",
                g.id === "showcase" ? "bg-frenz-blue" : g.id === "insights" ? "bg-frenz-violet" : "bg-frenz-ink",
              )}
            >
              {g.mark}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-heading text-[15px] font-bold text-frenz-ink">{g.title}</span>
              {owner ? <span className="text-xs text-frenz-muted">{g.ownerSub}</span> : null}
            </span>
          </div>
          <ul className="overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
            {g.rows.map((entry, i) => (
              <li key={entry.key} className={cn(i > 0 && "border-t border-frenz-line")}>
                <HubButton handle={handle} entry={entry} onOpen={openKey} />
              </li>
            ))}
          </ul>
        </div>
      ))}
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
