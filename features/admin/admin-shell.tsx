"use client";

import {
  Activity,
  Boxes,
  CreditCard,
  DollarSign,
  Flag,
  Flame,
  FlaskConical,
  Handshake,
  HeartPulse,
  Megaphone,
  Radio,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

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
  Boxes,
  CreditCard,
  DollarSign,
  Flag,
  Flame,
  FlaskConical,
  Handshake,
  HeartPulse,
  Megaphone,
  Radio,
  ShieldAlert,
  Users,
};

const SectionContext = createContext<string>(DEFAULT_ADMIN_SECTION);

const STORAGE_KEY = "frenz:admin-section";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string>(DEFAULT_ADMIN_SECTION);

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
      <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-10">
        <nav aria-label="Dashboard sections" className="mb-8 lg:mb-0">
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
                      return (
                        <li key={section.id} className="shrink-0">
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

/**
 * One section's panel. Visible only when selected.
 *
 * The heading and blurb come from the registry rather than being written at
 * each call site, so the nav label and the panel title can never disagree.
 */
export function AdminPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const active = useContext(SectionContext);
  const section = getAdminSection(id);
  const shown = active === id;

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
      {section ? (
        <header className="mb-6">
          <h2
            id={`admin-${id}-heading`}
            className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl"
          >
            {section.label}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{section.blurb}</p>
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Every section id, so the page can assert it rendered a panel for each. */
export const ALL_SECTION_IDS = ADMIN_SECTIONS.map((s) => s.id);
