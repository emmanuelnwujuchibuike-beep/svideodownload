"use client";

import { useRef } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * A sticky sub-navigation for one admin section.
 *
 * Owner, 2026-08-23: "organise all revenue and engagement and other section to
 * be arrange in each in a single page and separated by a top nav, for example,
 * in revenue, there should be a top nav that sticks at the top when scrolled,
 * and the top nav should have buttons like ad impression button, that opens
 * only ad impression chart and all detailed information, and visitors button
 * at the top nav that opens open visitors charts and all detailed information
 * ... so i can easily locate them each by their at the top without scrolling
 * down too much."
 *
 * ── Filters, rather than scroll-spy anchors ────────────────────────────────
 * The obvious reading of "top nav" is a set of anchors that scroll you to a
 * heading. That is NOT what was asked for, and it would not solve the stated
 * problem: the complaint is "without scrolling down too much", and anchors
 * still leave every other panel mounted below, so the page stays as long as it
 * was and the scrollbar still lies about how much there is. These buttons
 * SHOW ONE GROUP AND HIDE THE REST ("opens only ad impression chart"), so the
 * section is exactly as tall as whatever you asked to see.
 *
 * It also makes the charts cheaper: only the selected group's SVGs are in the
 * DOM at all.
 *
 * ── Why `sticky` on the bar and not on a wrapper ───────────────────────────
 * `position: sticky` resolves against the nearest scrolling ancestor, and it
 * silently does nothing if any ancestor has `overflow: hidden` — the trap
 * recorded in [[messaging-ui-verification-bugs]] for `position: fixed` inside
 * `backdrop-blur`. The bar sticks to the top of the admin page's own scroll
 * container, so the section card that hosts it must not clip its overflow;
 * `-mx` bleed below keeps the bar full-bleed inside a padded card without
 * needing one.
 */
export interface AdminTab {
  id: string;
  label: string;
  /** Optional count/scalar shown beside the label — e.g. a total for the window. */
  badge?: string;
}

export function AdminSectionTabs({
  tabs,
  active,
  onChange,
  className,
  /**
   * Distance from the top of the scroll container. Defaults to 0. Pass the
   * height of any app chrome that floats above this one, so the bar does not
   * come to rest underneath it.
   */
  topClassName = "top-0",
}: {
  tabs: AdminTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  topClassName?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const select = (id: string, el: HTMLButtonElement | null) => {
    haptic("selection");
    onChange(id);
    // Bring the chosen tab fully into view — on a phone the row scrolls
    // horizontally, and tapping a half-visible tab at the edge should not
    // leave it half-visible.
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Section"
      className={cn(
        "sticky z-20 -mx-5 mb-4 flex gap-1 overflow-x-auto border-b border-border/60 bg-card/95 px-5 py-2 backdrop-blur sm:-mx-6 sm:px-6",
        // Hide the horizontal scrollbar on desktop — the row is short enough
        // that a visible bar reads as a defect rather than an affordance.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        topClassName,
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`admin-panel-${tab.id}`}
            id={`admin-tab-${tab.id}`}
            onClick={(e) => select(tab.id, e.currentTarget)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              selected
                ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.badge ? (
              <span className={cn("ml-1.5 tabular-nums", selected ? "text-white/75" : "text-muted-foreground/70")}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One tab's content. Unmounts when not selected — see the component note above
 * on why these hide rather than scroll.
 */
export function AdminTabPanel({
  id,
  active,
  children,
  className,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`admin-panel-${id}`} aria-labelledby={`admin-tab-${id}`} className={className}>
      {children}
    </div>
  );
}
