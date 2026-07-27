import {
  BarChart3,
  Briefcase,
  Cloud,
  Download,
  Flame,
  Gift,
  Play,
  Rocket,
  ShoppingBag,
  Sparkles,
  Radio,
  Star,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

import { MaybeLink, ViewAll } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/* ── My Products & Tools ──────────────────────────────────────────────────── */
type Tool = { title: string; sub: string; icon: LucideIcon; tile: string; href?: string };

const TOOLS: Tool[] = [
  { title: "Downloader", sub: "Download anything", icon: Download, tile: "from-violet-500 to-purple-600", href: "/downloads" },
  { title: "Cloud Storage", sub: "Store & manage files", icon: Cloud, tile: "from-sky-500 to-blue-600" },
  { title: "Rewards", sub: "Earn & redeem", icon: Gift, tile: "from-amber-400 to-orange-500" },
  { title: "Marketplace", sub: "Buy & sell digital", icon: Store, tile: "from-rose-500 to-pink-600" },
  { title: "AI Studio", sub: "Edit with AI", icon: Sparkles, tile: "from-fuchsia-500 to-violet-600" },
  { title: "Creator Hub", sub: "Build your brand", icon: Rocket, tile: "from-indigo-500 to-blue-600" },
  { title: "Analytics", sub: "Track everything", icon: BarChart3, tile: "from-cyan-500 to-blue-600", href: "/account/analytics" },
  { title: "Live Streaming", sub: "Go live & earn", icon: Radio, tile: "from-red-500 to-rose-600" },
  { title: "Communities", sub: "Connect & share", icon: Users, tile: "from-emerald-500 to-teal-600" },
  { title: "Business Suite", sub: "Grow your business", icon: Briefcase, tile: "from-blue-500 to-indigo-600" },
];

export function ProductsTools() {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">My Products &amp; Tools</h2>
        <ViewAll feature="Products & Tools" />
      </div>
      <div className="grid grid-cols-5 gap-2 lg:gap-3">
        {TOOLS.map((t) => (
          <MaybeLink
            key={t.title}
            href={t.href}
            feature={t.title}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 p-2.5 text-center transition hover:border-border hover:bg-secondary/40 lg:flex-row lg:items-center lg:gap-3 lg:p-3 lg:text-left"
          >
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", t.tile)}>
              <t.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold leading-tight lg:truncate lg:text-sm">{t.title}</span>
              <span className="mt-0.5 hidden truncate text-xs text-muted-foreground lg:block">{t.sub}</span>
            </span>
          </MaybeLink>
        ))}
      </div>
    </section>
  );
}

/* ── Achievements ─────────────────────────────────────────────────────────── */
type Badge = { title: string; sub: string; icon: LucideIcon; tile: string };

const BADGES: Badge[] = [
  { title: "Top Downloader", sub: "10M+ Downloads", icon: Download, tile: "from-violet-500 to-purple-700" },
  { title: "Consistency King", sub: "100 Day Streak", icon: Flame, tile: "from-blue-500 to-indigo-700" },
  { title: "Gold Creator", sub: "Top 5% Creators", icon: Star, tile: "from-amber-400 to-yellow-600" },
  { title: "Marketplace Seller", sub: "₦500K+ Sales", icon: ShoppingBag, tile: "from-emerald-500 to-teal-700" },
];

function GemBadge({ icon: Icon, tile }: { icon: LucideIcon; tile: string }) {
  return (
    <span className="relative flex h-12 w-12 items-center justify-center lg:h-14 lg:w-14">
      <span className={cn("absolute inset-0 rotate-45 rounded-[32%] bg-gradient-to-br shadow-md ring-1 ring-inset ring-white/20", tile)} />
      <span aria-hidden className="absolute inset-[3px] rotate-45 rounded-[30%] bg-white/10" />
      <Icon className="relative h-5 w-5 text-white lg:h-6 lg:w-6" />
    </span>
  );
}

export function Achievements({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Achievements</h2>
        <ViewAll feature="Achievements" />
      </div>
      <div className="grid grid-cols-4 gap-2 lg:gap-3">
        {BADGES.map((b) => (
          <div key={b.title} className="flex flex-col items-center gap-2 text-center">
            <GemBadge icon={b.icon} tile={b.tile} />
            <span className="hidden lg:block">
              <span className="block text-xs font-semibold leading-tight">{b.title}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{b.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Recent posts ─────────────────────────────────────────────────────────── */
const POSTS = [
  { views: "12.4K", tile: "from-indigo-900 via-purple-800 to-slate-900" },
  { views: "8.7K", tile: "from-slate-900 via-blue-900 to-violet-900" },
  { views: "9.2K", tile: "from-neutral-800 via-neutral-900 to-black" },
  { views: "6.1K", tile: "from-orange-500 via-rose-600 to-purple-800" },
];

export function RecentPosts({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Recent Posts</h2>
        <ViewAll feature="Recent Posts" href="/downloads" />
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:grid-cols-4 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        {POSTS.map((p, i) => (
          <div
            key={i}
            className={cn(
              "relative aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br lg:w-auto",
              p.tile,
            )}
          >
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              <Play className="h-2.5 w-2.5 fill-white text-white" />
              {p.views}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
