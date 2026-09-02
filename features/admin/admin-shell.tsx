"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Bell,
  Boxes,
  Clapperboard,
  CreditCard,
  Database,
  DollarSign,
  Flag,
  Flame,
  FlaskConical,
  Handshake,
  HeartPulse,
  Home,
  Image,
  Languages,
  LayoutGrid,
  Headset,
  Megaphone,
  Palette,
  Pin,
  PinOff,
  Radio,
  Rss,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Telescope,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

import { AdminSearch } from "./admin-search";
import { AdminLogoutButton } from "@/features/admin/admin-logout-button";
import {
  ADMIN_CATEGORIES,
  ADMIN_SECTIONS,
  DEFAULT_ADMIN_SECTION,
  getAdminSection,
  sectionsInCategory,
} from "@/lib/admin/sections";
import { cn } from "@/lib/utils";

/**
 * The admin dashboard shell — categorised navigation over pre-rendered panels.
 *
 * ── Why every panel is rendered and only one is shown ─────────────────────────
 *
 * The brief was that opening a section must not load or delay. Fetching per
 * section on click would do exactly that — every switch a spinner. Instead the
 * server renders all sections in one pass (streamed, see below) and this shell
 * only toggles which is VISIBLE. Switching is then a class change: instant, no
 * request, no layout thrash.
 *
 * That is affordable here in a way it would not be on a public page: /admin is
 * one operator, already behind an auth redirect, and explicitly outside the
 * 2-second visitor budget.
 *
 * ── …and why that does not make the first paint slow ──────────────────────────
 *
 * The page used to `await Promise.all([...17 queries])` before rendering a
 * single byte, so the whole dashboard waited on its slowest query. Each section
 * now sits in its own `<Suspense>` on the server, so the shell and the default
 * section paint as soon as THEIR data is ready and the rest stream in behind.
 * The nav is usable immediately.
 *
 * ── Hidden with `hidden`, not unmounted ───────────────────────────────────────
 *
 * Unmounting would throw away scroll position, open editors and half-typed
 * forms every time an operator glanced at another section — and it would remount
 * the client panels, re-running their effects. `hidden` keeps them in the
 * document and out of the layout.
 */

const ICONS: Record<string, LucideIcon> = {
  Activity,
  BadgeCheck,
  Bell,
  Boxes,
  Clapperboard,
  CreditCard,
  Database,
  DollarSign,
  Flag,
  Flame,
  FlaskConical,
  Handshake,
  HeartPulse,
  Home,
  Image,
  Languages,
  LayoutGrid,
  Headset,
  Megaphone,
  Palette,
  Radio,
  Rss,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Telescope,
  Users,
  Wrench,
};

const SectionContext = createContext<string>(DEFAULT_ADMIN_SECTION);

const STORAGE_KEY = "frenz:admin-section";

/*
 * Pinned shortcuts — up to 5 sections an operator can jump straight to from
 * the top of the dashboard instead of hunting through the categorised nav
 * (owner, 2026-08-18: "admin can pin it to shortcut... pin at the top...
 * up to 5 sections"). `localStorage`, not the `sessionStorage` the active-
 * section memory above uses: a shortcut is meant to persist across visits,
 * not just the current tab session — this is a standing preference, not a
 * scroll-position-style return value.
 */
const PINS_STORAGE_KEY = "frenz:admin-pinned-sections";
const MAX_PINS = 5;

function usePinnedSections() {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as unknown;
      if (Array.isArray(ids)) {
        // Drop any id from a section that no longer exists (renamed/removed
        // since it was pinned) rather than rendering a dead shortcut.
        setPinned(ids.filter((id): id is string => typeof id === "string" && !!getAdminSection(id)).slice(0, MAX_PINS));
      }
    } catch {
      /* storage blocked — no pins is a fine answer */
    }
  }, []);

  const persist = (next: string[]) => {
    setPinned(next);
    try {
      localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* non-fatal — the toggle still worked for this session */
    }
  };

  const toggle = (id: string) => {
    if (pinned.includes(id)) {
      persist(pinned.filter((p) => p !== id));
    } else if (pinned.length < MAX_PINS) {
      persist([...pinned, id]);
    }
    // At the cap and not already pinned: no-op. The pin button disables
    // itself in that state (see the nav item below) rather than needing a
    // toast — there's no Toaster mounted on /admin to show one in.
  };

  return { pinned, toggle };
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string>(DEFAULT_ADMIN_SECTION);
  const { pinned, toggle: togglePin } = usePinnedSections();

  /*
    Restore the last section on return, read AFTER mount rather than during
    render — reading storage while rendering would produce different markup on
    the server and the client and trip hydration. The first paint is always the
    default section, which is also the one the brief wants leading.
  */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved && getAdminSection(saved)) setActive(saved);
    } catch {
      /* storage blocked — the default is a fine answer */
    }
  }, []);

  const select = (id: string) => {
    setActive(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* non-fatal */
    }
  };

  return (
    <SectionContext.Provider value={active}>
      {/*
        🔴 LOG OUT IS ALWAYS VISIBLE, at the top of the shell, on every section.

        It sits here rather than inside one panel or behind the account menu
        because it must be reachable in one glance from wherever the operator
        happens to be — a sign-out control that has to be hunted for is one that
        does not get used on a shared or borrowed machine.

        `justify-end` on its own row: it is deliberately NOT competing with the
        section nav below it for attention, but it is never further than the top
        of the page.
      */}
      <div className="mb-4 flex items-center justify-end px-3 sm:px-0">
        <AdminLogoutButton />
      </div>
      {/*
        Search every SETTING, not just the 32 section names (owner: "i cant find
        it" — the control was there and unfindable). Sits directly under the
        top row so it is the first thing on the page after log out.
      */}
      <AdminSearch onSelect={select} />
      {/*
        Pinned shortcuts — up to 5, chosen via the pin toggle on each nav
        item below. Sits at the very top of the dashboard shell (above the
        categorised nav + panel grid), only rendering once something is
        actually pinned so an operator who never uses it sees nothing extra.
      */}
      {pinned.length > 0 ? (
        <nav aria-label="Pinned shortcuts" className="mb-6 px-3 sm:px-0">
          <ul className="flex flex-wrap gap-2">
            {pinned.map((id) => {
              const section = getAdminSection(id);
              if (!section) return null;
              const Icon = ICONS[section.icon] ?? Activity;
              const isActive = active === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => select(id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    <Pin aria-hidden className="h-3.5 w-3.5 shrink-0 fill-current" />
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-10">
        <nav aria-label="Dashboard sections" className="mb-8 px-3 sm:px-0 lg:mb-0">
          <div className="lg:sticky lg:top-28 space-y-6">
            {ADMIN_CATEGORIES.map((category) => {
              const sections = sectionsInCategory(category.id);
              if (sections.length === 0) return null;

              return (
                <div key={category.id}>
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    {category.label}
                  </p>
                  <ul className="flex gap-1.5 overflow-x-auto lg:block lg:space-y-0.5 lg:overflow-visible">
                    {sections.map((section) => {
                      const Icon = ICONS[section.icon] ?? Activity;
                      const isActive = active === section.id;
                      const isPinned = pinned.includes(section.id);
                      const pinDisabled = !isPinned && pinned.length >= MAX_PINS;
                      return (
                        <li key={section.id} className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => select(section.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                              /*
                                Colour and background only. A transform here
                                would make the sticky container a containing
                                block and break `position: fixed` inside it —
                                the bug that has already cost this project a
                                header and a bottom ad.
                              */
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                          >
                            <Icon aria-hidden className="h-4 w-4 shrink-0" />
                            <span className="whitespace-nowrap">{section.label}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePin(section.id)}
                            disabled={pinDisabled}
                            aria-pressed={isPinned}
                            aria-label={isPinned ? `Unpin ${section.label}` : `Pin ${section.label} to shortcuts`}
                            title={pinDisabled ? `Up to ${MAX_PINS} pinned sections — unpin one first` : isPinned ? "Unpin" : "Pin to top"}
                            className={cn(
                              "shrink-0 rounded-lg p-1.5 transition-colors",
                              isPinned
                                ? "text-primary hover:bg-primary/10"
                                : "text-muted-foreground/50 hover:bg-secondary hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30",
                            )}
                          >
                            {isPinned ? (
                              <PinOff aria-hidden className="h-3.5 w-3.5" />
                            ) : (
                              <Pin aria-hidden className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </SectionContext.Provider>
  );
}

/** Scrolls an anchor into view, respecting reduced-motion. */
function jumpTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/**
 * One section's panel. Visible only when selected.
 *
 * The heading and blurb come from the registry rather than being written at
 * each call site, so the nav label and the panel title can never disagree.
 *
 * ── Jump to bottom / back to top (owner, 2026-08-16: "sections... not too
 *    long down that requires excess scrolling") ─────────────────────────────
 * Several panels (moderation, platform catalogues) run several screens tall.
 * Rather than shortening what they show, a plain anchor jump at each end lets
 * an operator skip the scroll entirely — down to check whether anything is
 * queued, or straight back up to the panel's own controls, without a single
 * frame of hand-scrolling either way. `scroll-mt-28` on the top anchor keeps
 * the fixed SiteHeader from covering the heading after the jump back up.
 */
export function AdminPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const active = useContext(SectionContext);
  const section = getAdminSection(id);
  const shown = active === id;
  const topId = `admin-${id}-top`;
  const bottomId = `admin-${id}-bottom`;

  return (
    <section
      id={`admin-${id}`}
      aria-labelledby={`admin-${id}-heading`}
      hidden={!shown}
      /*
        The site's own entrance animation, not a new one. `fade-up` is already
        defined in globals.css against the shared motion tokens and animates
        only opacity and transform, so it runs on the compositor and inherits
        the project's reduced-motion handling for free.
      */
      className={cn(!shown && "hidden", shown && "motion-safe:animate-fade-up")}
    >
      <div id={topId} className="scroll-mt-28" />
      {section ? (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3 px-3 sm:px-0">
          <div>
            <h2
              id={`admin-${id}-heading`}
              className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl"
            >
              {section.label}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{section.blurb}</p>
          </div>
          <button
            type="button"
            onClick={() => jumpTo(bottomId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" /> Jump to bottom
          </button>
        </header>
      ) : null}
      {children}
      <div className="mt-8 flex justify-center border-t border-border/60 px-3 pt-5 sm:px-0">
        <button
          type="button"
          onClick={() => jumpTo(topId)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
        >
          <ArrowUp aria-hidden className="h-3.5 w-3.5" /> Back to top
        </button>
      </div>
      <div id={bottomId} aria-hidden className="scroll-mt-28" />
    </section>
  );
}

/** Every section id, so the page can assert it rendered a panel for each. */
export const ALL_SECTION_IDS = ADMIN_SECTIONS.map((s) => s.id);
