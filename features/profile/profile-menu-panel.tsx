"use client";

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
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { signOutClient } from "@/lib/auth/sign-out";
import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * The profile menu's CONTENT — the owner's premium control center, built to the
 * owner reference `public/profilemenu.jpg`: brand header, gradient identity card,
 * the full app navigation with an active row, a "My Spaces" ecosystem block, a
 * Go Premium card and a footer with theme + version + sign-out.
 *
 * Extracted from `profile-menu.tsx` so the profile page's docked panel/sheet and
 * the top-right header avatar menu render the SAME component — the owner asked for
 * the header menu to be identical to this one, and sharing the component is the
 * only way that stays true as it changes.
 *
 * ── Kept off the cold-entry budget ────────────────────────────────────────────
 * This module pulls in the language table, the theme toggle and the inbox cache.
 * The header's trigger must therefore `import()` its sheet on tap rather than
 * import it statically — see `features/auth/user-menu.tsx`.
 *
 * Honesty rule (the "profile doorway" memory): only items with a REAL route are
 * links; ecosystem items that aren't built yet (Trending, News, Communities,
 * Cloud Storage, AI Studio, Marketplace) are marked "Soon", never links that 404.
 */

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

export interface MenuUser {
  /** Empty when the viewer hasn't picked one yet — the identity card then points at setup. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  plan: BillingPlan;
  verified: boolean;
}

type NavItem = {
  label: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  soon?: boolean;
  /** Renders the live unread-messages count (real data, never a placeholder). */
  badge?: "inbox";
};

const NAV: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Trending", icon: TrendingUp, soon: true },
  { label: "Reels", href: "/reels", icon: Film },
  { label: "News", icon: Newspaper, soon: true },
  { label: "Communities", icon: Users, soon: true },
  { label: "Friends", href: "/friends", icon: UsersRound },
  { label: "Chats", href: "/messages", icon: MessageCircle, badge: "inbox" },
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

/** The reference's boxed glyph: a hairline rounded tile that turns violet when the row is active. */
function NavTile({ icon: Icon, active }: { icon: ComponentType<{ className?: string }>; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition",
        active
          ? "bg-violet-500/15 text-violet-600 ring-violet-500/30 dark:text-violet-300"
          : "bg-secondary/60 text-foreground ring-border/60",
      )}
    >
      <Icon className="h-[19px] w-[19px]" />
    </span>
  );
}

export function ProfileMenuPanel({
  user,
  onNavigate,
  onClose,
}: {
  user: MenuUser;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Real unread count off the shared, realtime-backed inbox cache — the same
  // source the bottom nav's badge uses. Never a placeholder number.
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox, { revalidateOnFocus: false });
  const unread = inbox?.unread ?? 0;

  const signOut = async () => {
    onClose?.();
    await signOutClient();
    router.push("/");
    router.refresh();
  };

  // Exactly one row is active: the deepest matching route, so /account/plan lights
  // up Settings rather than nothing and /home never matches on a prefix.
  const activeIndex = NAV.reduce<number>((best, it, i) => {
    if (it.soon || !it.href) return best;
    const hit = it.href === "/home" ? pathname === "/home" : pathname === it.href || pathname.startsWith(`${it.href}/`);
    if (!hit) return best;
    return best < 0 || it.href.length > (NAV[best]!.href?.length ?? 0) ? i : best;
  }, -1);

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
        href={user.handle ? `/u/${user.handle}` : "/account/identity"}
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
            <span className="truncate text-sm text-muted-foreground">{user.handle ? `@${user.handle}` : "Set up your profile"}</span>
            {user.plan !== "free" ? <DiamondCrownBadge plan={user.plan} size="xs" showLabel /> : null}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>

      {/* Scrollable middle */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav>
          {NAV.map((it, i) => {
            const active = i === activeIndex;
            // Hairline between rows (reference) — suppressed either side of the
            // active row so its tinted pill isn't cut by a line.
            const divider = i < NAV.length - 1 && !active && i + 1 !== activeIndex;
            const inner = (
              <>
                {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-violet-600" /> : null}
                <NavTile icon={it.icon} active={active} />
                <span className={cn("flex-1 font-semibold", active ? "text-violet-600 dark:text-violet-300" : it.soon ? "text-muted-foreground" : undefined)}>
                  {it.label}
                </span>
                {it.soon ? <SoonPill /> : null}
                {it.badge === "inbox" && unread > 0 ? (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-bold text-violet-600 dark:text-violet-300">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
                {!it.soon ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" /> : null}
              </>
            );
            const rowClass = cn(
              "group relative flex items-center gap-3.5 rounded-xl px-3 py-2.5",
              divider && "border-b border-border/50",
              active && "bg-violet-500/10",
              !it.soon && !active && "transition hover:bg-secondary/70",
            );
            return it.soon ? (
              <div key={it.label} className={rowClass}>
                {inner}
              </div>
            ) : (
              <Link key={it.label} href={it.href!} onClick={onNavigate} className={rowClass}>
                {inner}
              </Link>
            );
          })}
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
            className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-100 via-fuchsia-50 to-violet-100 p-3.5 ring-1 ring-inset ring-violet-500/25 transition active:scale-[0.99] dark:from-violet-500/20 dark:via-fuchsia-500/10 dark:to-violet-500/20"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm">
              <Crown className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Go Premium</span>
              <span className="block text-xs text-muted-foreground">Unlock exclusive features</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
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
