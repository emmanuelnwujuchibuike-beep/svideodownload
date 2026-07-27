import {
  Bell,
  Bookmark,
  Clapperboard,
  Cloud,
  Compass,
  Crown,
  DollarSign,
  Download,
  Film,
  Home,
  type LucideIcon,
  Menu,
  MessageCircle,
  Newspaper,
  Package,
  Plus,
  Radio,
  Search,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { MaybeLink, SoonButton } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/* ── Primary sidebar nav ──────────────────────────────────────────────────────
   `href` set → the route is built and navigates; `href` omitted → the feature is
   still coming, so it announces "coming soon" instead of dead-ending. */
type NavRow = { label: string; icon: LucideIcon; href?: string; badge?: string; live?: boolean };

const PRIMARY: NavRow[] = [
  { label: "Home", icon: Home, href: "/home" },
  { label: "Explore", icon: Compass, href: "/explore" },
  { label: "Trending", icon: TrendingUp, href: "/explore?sort=trending" },
  { label: "Reels", icon: Film, href: "/reels" },
  { label: "News", icon: Newspaper, href: "/blog" },
  { label: "Communities", icon: Users },
  { label: "Friends", icon: Users, href: "/friends" },
  { label: "Chats", icon: MessageCircle, href: "/messages", badge: "8" },
  { label: "Downloads", icon: Download, href: "/downloads" },
  { label: "Saved", icon: Bookmark, href: "/saved" },
];

const SPACES: NavRow[] = [
  { label: "My Cloud", icon: Cloud },
  { label: "My Studio", icon: Clapperboard },
  { label: "My Products", icon: Package },
  { label: "My Earnings", icon: DollarSign },
  { label: "My Live", icon: Radio, live: true },
];

function SidebarRow({ row }: { row: NavRow }) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-muted-foreground transition-colors group-hover:bg-secondary group-hover:text-foreground">
        <row.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1 truncate">{row.label}</span>
      {row.badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 px-1.5 text-[11px] font-bold text-white">
          {row.badge}
        </span>
      ) : null}
      {row.live ? (
        <span className="rounded-md bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          Live
        </span>
      ) : null}
    </>
  );
  const cls =
    "group flex items-center gap-3 rounded-2xl px-2.5 py-1.5 text-[15px] font-medium text-foreground/90 transition-colors hover:bg-secondary/60";
  return row.href ? (
    <Link href={row.href} className={cls}>
      {inner}
    </Link>
  ) : (
    <SoonButton feature={row.label} className={cn(cls, "w-full text-left")}>
      {inner}
    </SoonButton>
  );
}

/** Desktop left navigation. Reserves its width in the flex row (the aside is fixed). */
export function ProfileSidebar() {
  return (
    <>
      <div className="hidden w-64 shrink-0 lg:block" aria-hidden />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/70 bg-card px-3 py-4 lg:flex">
        <Link href="/" className="mb-5 flex shrink-0 items-center px-2">
          <FrenzWordmark size={32} textClassName="text-lg" priority tile />
        </Link>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <nav className="flex flex-col gap-0.5">
            {PRIMARY.map((r) => (
              <SidebarRow key={r.label} row={r} />
            ))}
          </nav>

          <p className="mb-1 mt-6 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
            My Spaces
          </p>
          <nav className="flex flex-col gap-0.5">
            {SPACES.map((r) => (
              <SidebarRow key={r.label} row={r} />
            ))}
          </nav>
        </div>

        {/* Premium upsell — pinned to the bottom */}
        <div className="mt-3 shrink-0 rounded-3xl border border-violet-500/20 bg-gradient-to-br from-blue-600/10 via-violet-600/10 to-purple-600/10 p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
              <Crown className="h-3.5 w-3.5 fill-white" />
            </span>
            Frenz Premium
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Unlock all features and grow your brand faster.
          </p>
          <Link
            href="/pricing"
            className="mt-3 flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2 text-xs font-bold text-white shadow-md shadow-violet-500/30 transition hover:opacity-95"
          >
            Upgrade Now
          </Link>
        </div>
      </aside>
    </>
  );
}

/** Small counter badge for the top-bar action icons. */
function ActionBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">
      {count}
    </span>
  );
}

/** The "CM" gradient avatar used in the chrome + reused for placeholders. */
export function ChromeAvatar({ size = 40, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-600 font-bold text-white",
        ring && "ring-2 ring-primary/40",
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      CM
    </span>
  );
}

/** Desktop top bar — search, Create, notifications, chats, avatar. */
export function ProfileTopbar() {
  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center gap-4 border-b border-border/70 bg-card px-5 lg:flex">
      <Link
        href="/search"
        className="group flex h-11 max-w-xl flex-1 items-center gap-3 rounded-full bg-secondary/60 px-4 text-sm text-muted-foreground ring-1 ring-inset ring-transparent transition hover:bg-secondary focus:ring-2 focus:ring-primary/40"
      >
        <Search className="h-[18px] w-[18px]" />
        <span className="flex-1">Search videos, people, hashtags…</span>
        <kbd className="hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium md:block">
          ⌘K
        </kbd>
      </Link>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          href="/create/post"
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
        >
          <Plus className="h-4 w-4" /> Create
        </Link>
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <ActionBadge count={6} />
        </Link>
        <Link
          href="/messages"
          aria-label="Messages"
          className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <MessageCircle className="h-5 w-5" />
          <ActionBadge count={3} />
        </Link>
        <MaybeLink href="/account" feature="Account menu" ariaLabel="Your account" className="rounded-full">
          <ChromeAvatar size={40} />
        </MaybeLink>
      </div>
    </header>
  );
}

/** Mobile top bar — logo + search/notifications/chats/menu. */
export function ProfileMobileHeader() {
  return (
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
        <SoonButton
          feature="Menu"
          ariaLabel="Menu"
          className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 text-foreground"
        >
          <Menu className="h-[22px] w-[22px]" />
        </SoonButton>
      </div>
    </header>
  );
}

/* ── Mobile bottom nav ────────────────────────────────────────────────────────
   Home · Friends · (Create) · Chats · Profile — Profile is the active tab here. */
export function ProfileBottomNav() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(calc(env(safe-area-inset-bottom)-10px),0.375rem)] lg:hidden">
      <nav
        aria-label="Primary"
        className="glass-strong relative mx-auto flex max-w-md items-end justify-around rounded-full px-3 pb-1.5 pt-2 backdrop-blur-lg"
      >
        <BottomTab label="Home" href="/home" icon={Home} />
        <BottomTab label="Friends" href="/friends" icon={Users} />

        {/* Create — the signature raised gradient circle */}
        <SoonButton feature="Create" ariaLabel="Create" className="-mt-6 self-center">
          <span className="relative flex h-[52px] w-[52px] items-center justify-center">
            <span aria-hidden className="bg-brand absolute inset-0 rounded-full opacity-45 blur-[10px]" />
            <span className="bg-brand relative flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lg shadow-violet-500/30 ring-[3px] ring-card/80">
              <Plus className="h-6 w-6" strokeWidth={2.4} />
            </span>
          </span>
        </SoonButton>

        <BottomTab label="Chats" href="/messages" icon={MessageCircle} badge={5} />
        <BottomTab label="Profile" href="/profile" icon={User} active />
      </nav>
    </div>
  );
}

function BottomTab({
  label,
  href,
  icon: Icon,
  badge = 0,
  active = false,
}: {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  active?: boolean;
}) {
  return (
    <Link href={href} className="relative flex flex-col items-center gap-1 px-2 pb-0.5">
      <span className="relative flex h-7 w-7 items-center justify-center">
        <Icon className={cn("h-[22px] w-[22px] transition-colors", active ? "text-primary" : "text-muted-foreground")} />
        {badge > 0 ? (
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span className={cn("text-[10px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground")}>
        {label}
      </span>
    </Link>
  );
}
