"use client";

import {
  BarChart3,
  Bell,
  Bookmark,
  Briefcase,
  Cloud,
  Compass,
  Crown,
  DollarSign,
  Download,
  Film,
  Gift,
  Home,
  type LucideIcon,
  Menu,
  MessageCircle,
  Newspaper,
  Radio,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { comingSoon } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

type Row = { label: string; icon: LucideIcon; href?: string; badge?: string; live?: boolean };

// Real, built routes navigate; product-ecosystem entries (no backend yet)
// announce "coming soon".
const PRIMARY: Row[] = [
  { label: "Home", icon: Home, href: "/home" },
  { label: "Explore", icon: Compass, href: "/explore" },
  { label: "Trending", icon: TrendingUp, href: "/explore?sort=trending" },
  { label: "Reels", icon: Film, href: "/reels" },
  { label: "News", icon: Newspaper, href: "/blog" },
  { label: "Communities", icon: Users, href: "/explore" },
  { label: "Friends", icon: Users, href: "/friends" },
  { label: "Chats", icon: MessageCircle, href: "/messages" },
  { label: "Downloads", icon: Download, href: "/downloads" },
  { label: "Saved", icon: Bookmark, href: "/saved" },
  { label: "Settings", icon: Settings, href: "/account" },
];

const PRODUCTS: Row[] = [
  { label: "Cloud Storage", icon: Cloud },
  { label: "AI Studio", icon: Sparkles },
  { label: "Marketplace", icon: Store },
  { label: "Rewards", icon: Gift },
  { label: "Earnings", icon: DollarSign },
  { label: "Live Streaming", icon: Radio, live: true },
  { label: "Creator Hub", icon: Rocket },
  { label: "Analytics", icon: BarChart3, href: "/account/analytics" },
  { label: "Business Suite", icon: Briefcase },
];

function DrawerRow({ row, onDone }: { row: Row; onDone: () => void }) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-muted-foreground">
        <row.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1">{row.label}</span>
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
    <button type="button" onClick={() => { comingSoon(row.label); onDone(); }} className={cn(cls, "w-full text-left")}>
      {inner}
    </button>
  );
}

function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link href={href} aria-label={label} className="flex h-10 w-10 items-center justify-center text-foreground">
      <Icon className="h-[22px] w-[22px]" />
    </Link>
  );
}

/**
 * The profile's MOBILE top bar + slide-in menu (owner: "mobile view doesnt have a
 * menu or menu toggle … the premium menu is not there"). The hamburger opens a
 * drawer with the full navigation + all products + the Frenz Premium card — the
 * same reach the desktop sidebar gives. Opaque + safe-area padded so it never
 * covers the cover. Desktop uses the app sidebar/top bar, so this is `lg:hidden`.
 */
export function ProfileMobileMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

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
      {/* Safe-area padding sits OUTSIDE a fixed-height bar — never as padding
          inside a fixed h-14 (that squeezes the wordmark/icons up into the
          notch and down over the page, the "header goes into the safe areas"
          bug). Total height = safe-top + the 3.5rem bar. */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/40 bg-background/70 pt-[var(--frenz-safe-top)] backdrop-blur-2xl backdrop-saturate-150 lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/home" className="flex items-center">
            <FrenzWordmark size={28} textClassName="text-base" priority />
          </Link>
          <div className="flex items-center gap-0.5">
            <IconLink href="/search" label="Search" icon={Search} />
            <IconLink href="/notifications" label="Notifications" icon={Bell} />
            <IconLink href="/messages" label="Messages" icon={MessageCircle} />
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="ml-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 text-foreground"
            >
              <Menu className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>
      </header>

      {/* Backdrop */}
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

      {/* Slide-in drawer */}
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
          <button type="button" onClick={close} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
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
            {PRODUCTS.map((r) => (
              <DrawerRow key={r.label} row={r} onDone={close} />
            ))}
          </div>

          <div className="mt-5 rounded-3xl border border-violet-500/20 bg-gradient-to-br from-blue-600/10 via-violet-600/10 to-purple-600/10 p-4">
            <p className="flex items-center gap-2 text-sm font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <Crown className="h-3.5 w-3.5 fill-white" />
              </span>
              Frenz Premium
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• No Ads</li>
              <li>• Download 4K videos</li>
              <li>• Faster downloads</li>
              <li>• And much more!</li>
            </ul>
            <Link href="/pricing" onClick={close} className="mt-3 flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2 text-xs font-bold text-white shadow-md shadow-violet-500/30">
              Upgrade Now
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}
