"use client";

import { Bell, Menu, MessageCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { PremiumCard } from "@/components/profile/dashboard/chrome";
import { PRIMARY, SPACES, type NavRow } from "@/components/profile/dashboard/nav-data";
import { comingSoon } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

function ActionBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
      {count}
    </span>
  );
}

function DrawerRow({ row, onDone }: { row: NavRow; onDone: () => void }) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-muted-foreground">
        <row.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1">{row.label}</span>
      {row.badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 px-1.5 text-[11px] font-bold text-white">
          {row.badge}
        </span>
      ) : null}
      {row.live ? (
        <span className="rounded-md bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Live</span>
      ) : null}
    </>
  );
  const cls = "flex min-h-[44px] items-center gap-3 rounded-2xl px-2.5 py-2 text-[15px] font-medium transition-colors hover:bg-secondary/60";
  return row.href ? (
    <Link href={row.href} onClick={onDone} className={cls}>
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => {
        comingSoon(row.label);
        onDone();
      }}
      className={cn(cls, "w-full text-left")}
    >
      {inner}
    </button>
  );
}

/**
 * Mobile top bar + slide-in menu drawer. The hamburger opens the SAME navigation
 * the desktop sidebar shows (owner, 2026-07-27: "didnt you see the mobile menu
 * style from the large screen? build everything") — not a "coming soon". Built,
 * real routes navigate; only genuinely-unbuilt entries announce coming soon.
 */
export function ProfileMobileHeader() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Escape closes; scroll-lock the page behind the sheet while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-card/90 px-4 pt-[var(--frenz-safe-top)] backdrop-blur-xl lg:hidden">
        <Link href="/" className="flex items-center">
          <FrenzWordmark size={28} textClassName="text-base" priority />
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/search" aria-label="Search" className="flex h-10 w-10 items-center justify-center text-foreground">
            <Search className="h-[22px] w-[22px]" />
          </Link>
          <Link href="/notifications" aria-label="Notifications" className="relative flex h-10 w-10 items-center justify-center text-foreground">
            <Bell className="h-[22px] w-[22px]" />
            <ActionBadge count={6} />
          </Link>
          <Link href="/messages" aria-label="Messages" className="relative flex h-10 w-10 items-center justify-center text-foreground">
            <MessageCircle className="h-[22px] w-[22px]" />
            <ActionBadge count={3} />
          </Link>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 text-foreground"
          >
            <Menu className="h-[22px] w-[22px]" />
          </button>
        </div>
      </header>

      {/* Dimmed backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={close}
        className={cn(
          "fixed inset-0 z-[65] bg-background/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Slide-in sheet (from the right) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={cn(
          "fixed inset-y-0 right-0 z-[70] flex w-[86%] min-w-[17rem] max-w-sm flex-col border-l border-border/70 bg-card shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 pb-3 pt-[max(0.875rem,var(--frenz-safe-top))]">
          <FrenzWordmark size={28} textClassName="text-base" />
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex flex-col gap-0.5">
            {PRIMARY.map((r) => (
              <DrawerRow key={r.label} row={r} onDone={close} />
            ))}
          </div>

          <p className="mb-1 mt-5 px-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">My Spaces</p>
          <div className="flex flex-col gap-0.5">
            {SPACES.map((r) => (
              <DrawerRow key={r.label} row={r} onDone={close} />
            ))}
          </div>

          <div className="mt-5">
            <PremiumCard />
          </div>
        </nav>
      </div>
    </>
  );
}
