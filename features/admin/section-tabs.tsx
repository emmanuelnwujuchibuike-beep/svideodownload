"use client";

import { useRef, useState } from "react";

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
        /*
          🔴 THE ROW KEEPS ITS OWN INSET (owner, 2026-08-25, with a screenshot:
          "this top nav in live activity and some other section touches the end
          a lot, i want it to have atleast padding x of 2").

          The bar is full-bleed by design — `-mx-5` cancels the card's padding so
          the border-bottom reaches both edges rather than stopping short and
          reading as a stray rule. But the BUTTONS were riding that same bleed
          out to the very edge, so the first tab was flush against the screen on
          a phone and looked clipped rather than scrollable.

          `px-7` = the card's `px-5` that was cancelled, plus the `px-2` the
          owner asked for (`sm:px-8` for the `sm:-mx-6` variant). The bleed and
          the inset are therefore independent: the rule still spans the full
          width, and the tabs sit 8px inside it at both ends. `scroll-px` makes
          the same gap apply when a tab is scrolled to — without it
          `scrollIntoView` parks the active tab flush against the edge again and
          undoes the fix the moment anyone uses the row.
        */
        "sticky z-20 -mx-5 mb-4 flex gap-1 overflow-x-auto scroll-px-2 border-b border-border/60 bg-card/95 px-7 py-2 backdrop-blur sm:-mx-6 sm:px-8",
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
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SAME TOP NAV, APPLIED TO A WHOLE ADMIN PANEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-25: *"arrange the ad placement and all sections in the admin
 * dashboard to be arranged like the revenue and engagement section with a top
 * nav so i dont scroll down much"*.
 *
 * Revenue got this treatment by hand inside `revenue-charts.tsx`. Every other
 * long panel stacks its blocks vertically, so reaching the ad placements meant
 * scrolling past the whole monetization form, the multi-link monitor and the
 * reward-network routing first.
 *
 * `app/admin/page.tsx` is a SERVER component, so it cannot hold the selected
 * tab itself. Each group's content is passed in as an already-rendered node
 * and this client component only decides which one is visible — no data moves
 * to the client that was not already going there.
 *
 * ── 🔴 These HIDE, they do not unmount (unlike `AdminTabPanel`) ────────────
 *
 * `AdminTabPanel` unmounts, and for Revenue that is right: its groups are
 * charts, and keeping six sets of SVGs in the DOM is the cost the tabs exist
 * to avoid.
 *
 * The panels here are mostly FORMS — ad placements, pricing, limits, promo
 * codes. Unmounting one would discard a half-typed edit the moment an operator
 * glanced at another group, which is precisely the reason `AdminShell` gives
 * for hiding its own panels rather than unmounting them. `hidden` takes the
 * content out of the layout, which is the entire ask ("i dont scroll down
 * much"), while leaving the form state and any open editor intact.
 *
 * Pass `unmountInactive` for a group set that is genuinely chart-shaped and
 * has no state worth keeping.
 */
export function AdminSubsections({
  groups,
  className,
  topClassName,
  unmountInactive = false,
}: {
  groups: { id: string; label: string; badge?: string; content: React.ReactNode }[];
  className?: string;
  topClassName?: string;
  unmountInactive?: boolean;
}) {
  const [active, setActive] = useState(groups[0]?.id ?? "");

  // One group is not a choice — render it plainly rather than growing a tab bar
  // that can only ever select what is already showing. Same rule the reels tab
  // bar follows.
  if (groups.length < 2) return <>{groups[0]?.content ?? null}</>;

  return (
    <div className={className}>
      <AdminSectionTabs
        tabs={groups.map(({ id, label, badge }) => ({ id, label, badge }))}
        active={active}
        onChange={setActive}
        topClassName={topClassName}
      />
      {groups.map((group) => {
        const selected = group.id === active;
        if (unmountInactive && !selected) return null;
        return (
          <div
            key={group.id}
            role="tabpanel"
            id={`admin-panel-${group.id}`}
            aria-labelledby={`admin-tab-${group.id}`}
            hidden={!selected}
            className={cn(!selected && "hidden")}
          >
            {group.content}
          </div>
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
