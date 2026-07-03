"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Bookmark,
  ChevronRight,
  Download,
  LayoutGrid,
  LogOut,
  Settings,
  Sparkles,
  UserCog,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ComponentType, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

type Item = { label: string; sub: string; href: string; icon: ComponentType<{ className?: string }>; soon?: boolean };

const ITEMS: Item[] = [
  { label: "Edit profile", sub: "Name, bio, avatar & banner", href: "/account#profile", icon: UserCog },
  { label: "Creator Studio", sub: "Your reach, views & audience", href: "/account/analytics", icon: BarChart3 },
  { label: "Saved", sub: "Posts you bookmarked", href: "/saved", icon: Bookmark },
  { label: "My downloads", sub: "Everything you've saved", href: "/downloads", icon: Download },
  { label: "Notifications", sub: "Activity & alerts", href: "/notifications", icon: Bell },
  { label: "Settings", sub: "Account, privacy & security", href: "/account", icon: Settings },
];

/** Shared panel body — used by both the desktop dock and the mobile drawer. */
function PanelBody({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  return (
    <>
      {/* Header */}
      <div className="relative overflow-hidden px-5 pb-4 pt-5">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-blue-600/25 to-violet-600/25 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Sparkles className="h-4 w-4 text-foreground" /> <span className="text-gradient">Your space</span>
          </h2>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Items */}
      <nav className="flex-1 space-y-1.5 px-3 pb-4">
        {ITEMS.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-secondary/70"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-inset ring-border/60">
              <it.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{it.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
          </Link>
        ))}

        <div className="mt-2 flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">Appearance</span>
          <ThemeToggle />
        </div>
      </nav>

      {/* Sign out */}
      <div className="border-t border-border/60 p-3">
        <form action="/auth/signout" method="post">
          <button type="submit" className="flex w-full items-center gap-2 rounded-2xl px-3 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground">
            <LogOut className="h-[18px] w-[18px]" /> Sign out
          </button>
        </form>
        <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground/70">More tools are on the way ✨</p>
      </div>
    </>
  );
}

/**
 * Profile control center — the home for settings, Creator Studio and everything
 * to come. Owner-only. On desktop (lg+) it's an always-open panel docked on the
 * right, in-flow with the page so it never collides with the top bar. On smaller
 * screens it collapses to a top-right button that opens a slide-in drawer. New
 * features drop straight into ITEMS and appear in both.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Desktop dock — fixed, full-height panel on the right edge (mirrors the
          left sidebar). Starts below the top bar (top-16) so it never covers it. */}
      <aside className="fixed right-0 top-16 bottom-0 z-20 hidden w-72 flex-col overflow-y-auto border-l border-border/60 bg-gradient-to-b from-card/70 to-card/30 backdrop-blur-xl lg:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PanelBody />
      </aside>

      {/* Mobile trigger — hidden once the dock is shown */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="fixed right-3 top-3 z-[60] flex h-10 w-10 items-center justify-center rounded-xl bg-background/70 text-foreground ring-1 ring-inset ring-border/60 backdrop-blur-xl transition hover:bg-secondary lg:hidden"
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="fixed inset-y-0 right-0 z-[80] flex w-[86%] max-w-sm flex-col overflow-y-auto border-l border-border/60 bg-card/95 backdrop-blur-xl lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Profile menu"
            >
              <PanelBody onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
