"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Bookmark,
  ChevronRight,
  Cloud,
  Compass,
  Crown,
  Download,
  Film,
  Home,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Newspaper,
  Settings,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentType, useEffect, useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutClient } from "@/lib/auth/sign-out";
import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * Profile menu — the owner's premium control center (owner reference:
 * public/profilemenu.jpg). A native-style sheet: gradient identity card, the full
 * app navigation, a "My Spaces" ecosystem block, a Go Premium card and a footer
 * with theme + version + sign-out.
 *
 * On desktop (lg+) it's an always-open panel docked on the right; on mobile it's a
 * bottom sheet opened from a top-right button. Honesty rule (see the "profile
 * doorway" memory): only items with a REAL route are links; ecosystem items that
 * aren't built yet (Trending, News, Communities, Cloud Storage, AI Studio,
 * Marketplace) are shown as "Soon", never as links that 404.
 */

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

interface MenuUser {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  plan: BillingPlan;
  verified: boolean;
}

type NavItem = { label: string; href?: string; icon: ComponentType<{ className?: string }>; soon?: boolean };

const NAV: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Trending", icon: TrendingUp, soon: true },
  { label: "Reels", href: "/reels", icon: Film },
  { label: "News", icon: Newspaper, soon: true },
  { label: "Communities", icon: Users, soon: true },
  { label: "Friends", href: "/friends", icon: UsersRound },
  { label: "Chats", href: "/messages", icon: MessageCircle },
  { label: "Downloads", href: "/downloads", icon: Download },
  { label: "Saved", href: "/saved", icon: Bookmark },
  { label: "Settings", href: "/account", icon: Settings },
];

const SPACES = [
  { label: "Cloud Storage", sub: "Store and access your files", icon: Cloud, tint: "from-sky-500/15 to-blue-500/15 text-sky-500" },
  { label: "AI Studio", sub: "Create, edit and generate", icon: Sparkles, tint: "from-violet-500/15 to-purple-500/15 text-violet-500" },
  { label: "Marketplace", sub: "Buy, sell and discover", icon: ShoppingBag, tint: "from-fuchsia-500/15 to-pink-500/15 text-fuchsia-500" },
];

function SoonPill() {
  return <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Soon</span>;
}

function PanelBody({ user, onNavigate, onClose }: { user: MenuUser; onNavigate?: () => void; onClose?: () => void }) {
  const router = useRouter();

  const signOut = async () => {
    onClose?.();
    await signOutClient();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand header */}
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-black text-white shadow-sm">F</span>
          <span className="text-lg font-bold tracking-tight">Frenz</span>
        </span>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {/* Identity card */}
      <Link
        href={`/u/${user.handle}`}
        onClick={onNavigate}
        className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-100 via-fuchsia-50 to-pink-100 p-3 ring-1 ring-inset ring-border/40 transition active:scale-[0.99] dark:from-violet-500/15 dark:via-fuchsia-500/10 dark:to-pink-500/15"
      >
        <span className="relative shrink-0">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-background" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-lg font-bold text-white ring-2 ring-background">
              {user.displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-base font-bold text-foreground">{user.displayName}</span>
            {user.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" /> : null}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-sm text-muted-foreground">@{user.handle}</span>
            {user.plan !== "free" ? <DiamondCrownBadge plan={user.plan} size="xs" showLabel /> : null}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>

      {/* Scrollable middle */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav className="space-y-0.5">
          {NAV.map((it) =>
            it.soon ? (
              <div key={it.label} className="flex items-center gap-3.5 rounded-xl px-3 py-3">
                <it.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 font-semibold text-muted-foreground">{it.label}</span>
                <SoonPill />
              </div>
            ) : (
              <Link key={it.label} href={it.href!} onClick={onNavigate} className="group flex items-center gap-3.5 rounded-xl px-3 py-3 transition hover:bg-secondary/70">
                <it.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1 font-semibold">{it.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
              </Link>
            ),
          )}
        </nav>

        {/* My Spaces */}
        <p className="mb-2 mt-4 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">My Spaces</p>
        <div className="space-y-2">
          {SPACES.map((s) => (
            <div key={s.label} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3">
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-border/40", s.tint)}>
                <s.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.sub}</span>
              </span>
              <SoonPill />
            </div>
          ))}
        </div>

        {/* Language */}
        <div className="mt-3">
          <LanguageSettingRow className="border border-border/60 bg-card" />
        </div>

        {/* Go Premium */}
        {user.plan === "free" ? (
          <Link
            href="/account/plan"
            onClick={onNavigate}
            className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-3.5 text-white shadow-lg shadow-violet-500/25 transition active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-inset ring-white/25">
              <Crown className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Go Premium</span>
              <span className="block text-xs text-white/85">Unlock exclusive features</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        ) : null}
      </div>

      {/* Footer — theme · version · sign out */}
      <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
        <ThemeToggle />
        <span className="text-[11px] font-medium text-muted-foreground/60">{APP_BUILD ? `v${APP_BUILD.slice(0, 7)}` : "Frenz"}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-rose-500"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

export function ProfileMenu(user: MenuUser) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Desktop dock — always-open panel alongside the content. */}
      <aside className="hidden shrink-0 lg:block lg:w-72">
        <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col overflow-hidden border-l border-border/60 bg-gradient-to-b from-card/70 to-card/30 backdrop-blur-xl">
          <PanelBody user={user} />
        </div>
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="fixed right-3 top-[calc(0.75rem+var(--frenz-safe-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-xl bg-background/70 text-foreground ring-1 ring-inset ring-border/60 backdrop-blur-xl transition hover:bg-secondary lg:hidden"
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </button>

      {/* Mobile bottom sheet (matches the reference). `open` gates pointer-events
          synchronously so a stray tap never outlives the closing animation. */}
      <div className={open ? undefined : "pointer-events-none"}>
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
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 40 }}
                className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[92vh] flex-col overflow-hidden rounded-t-[1.75rem] border-t border-border/60 bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl lg:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Profile menu"
              >
                <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />
                <PanelBody user={user} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}
