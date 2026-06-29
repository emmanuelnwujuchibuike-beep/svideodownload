"use client";

import {
  Bookmark,
  Clapperboard,
  Compass,
  Crown,
  Download,
  Home,
  MessageCircle,
  Newspaper,
  Plus,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useShowAds } from "@/features/monetization/use-show-ads";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  badge?: string;
  soon?: boolean;
}

export function buildNav(handle: string | null): NavItem[] {
  return [
    { label: "Home", href: "/home", icon: Home },
    { label: "Explore", href: "/explore", icon: Compass },
    { label: "Trending", href: "/explore?sort=trending", icon: TrendingUp },
    { label: "Reels", href: "/explore", icon: Clapperboard, soon: true },
    { label: "News", href: "/blog", icon: Newspaper },
    { label: "Communities", href: "/explore", icon: Users, soon: true },
    { label: "Friends", href: handle ? `/u/${handle}/following` : "/account#profile", icon: UsersRound },
    { label: "Chat", href: "/messages", icon: MessageCircle },
    { label: "Downloads", href: "/account", icon: Download },
    { label: "Saved", href: "/saved", icon: Bookmark },
  ];
}

const SPACES = [
  { label: "Photography Club", color: "from-rose-500 to-pink-600" },
  { label: "Football Fans", color: "from-emerald-500 to-teal-600" },
  { label: "Music Lovers", color: "from-violet-500 to-purple-600" },
  { label: "Travel World", color: "from-sky-500 to-blue-600" },
];

export function AppSidebar({ handle }: { handle: string | null }) {
  const pathname = usePathname();
  const nav = buildNav(handle);
  const { showAds, ready } = useShowAds();
  const isPremium = ready && !showAds;

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-card/40 px-3 py-4 lg:flex">
      {/* Brand */}
      <Link href="/home" className="mb-5 flex items-center gap-2.5 px-2 font-bold">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-violet-600 to-purple-600 text-white shadow-md shadow-violet-500/30">
          <Download className="h-4 w-4" />
        </span>
        <span className="text-lg tracking-tight text-gradient">Frenz</span>
      </Link>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5">
        {nav.map((item) => {
          const active =
            item.href === pathname || (item.href !== "/home" && pathname.startsWith(item.href.split("?")[0]!) && item.href !== "/explore" && item.href !== "/account");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-gradient-to-r from-blue-600/15 to-violet-600/15 text-foreground ring-1 ring-inset ring-violet-500/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <item.icon className={cn("h-[18px] w-[18px]", active && "text-primary")} />
              <span className="flex-1">{item.label}</span>
              {item.soon ? (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Soon</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Spaces */}
      <div className="mt-6">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">Your Spaces</p>
        <div className="mt-2 flex flex-col gap-0.5">
          {SPACES.map((s) => (
            <Link key={s.label} href="/explore" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground">
              <span className={cn("h-6 w-6 rounded-lg bg-gradient-to-br", s.color)} />
              <span className="truncate">{s.label}</span>
            </Link>
          ))}
          <Link href="/explore" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-primary transition hover:bg-secondary">
            <Plus className="h-[18px] w-[18px]" /> Create New Space
          </Link>
        </div>
      </div>

      {/* Premium card */}
      {!isPremium ? (
        <div className="mt-auto rounded-2xl bg-gradient-to-br from-blue-600/10 via-violet-600/10 to-purple-600/10 p-4 ring-1 ring-inset ring-violet-500/20">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Crown className="h-4 w-4 text-amber-500" /> Frenz Premium
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>• No Ads</li>
            <li>• Download 4K videos</li>
            <li>• Faster downloads</li>
            <li>• And much more!</li>
          </ul>
          <Link
            href="/pricing"
            className="mt-3 flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2 text-xs font-semibold text-white shadow-md transition hover:opacity-95"
          >
            Upgrade Now
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
