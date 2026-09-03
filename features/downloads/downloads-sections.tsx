"use client";

import {
  ArrowRight,
  Bookmark,
  Check,
  Cloud,
  CloudDownload,
  Download,
  Flame,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Lock,
  MoreVertical,
  Shield,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { estimateBytes, limitForPlan, totalUsedBytes } from "@/features/history/usage";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { DownloadRecord } from "@/types";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";
import { StreakHeroIndicator } from "@/features/streaks/streak-hero-indicator";

/**
 * The download page's sections, built to the owner's reference
 * (public/new downloadpage.jpg), top to bottom: hero, cloud-storage card, stat
 * tiles, recent downloads, quick actions, trust strip.
 *
 * ── Everything here is computed from the viewer's REAL history ────────────────
 * Counts, sizes, averages and "downloaded today" all derive from the local
 * download records; there are no seeded or illustrative numbers anywhere. Where
 * the reference showed a figure we cannot honestly produce — its "2M+ downloads"
 * and "120K+ happy users" — the trust strip states the guarantee instead of
 * inventing a number (the owner's standing rule, declined three times before).
 */

/* ────────────────────────────────── Hero ─────────────────────────────────── */

/**
 * 🔴 THE HERO IS THE LANDING'S HERO NOW (owner, 2026-08-11: "i want the download
 * page to be a blend of the landing page and the download page as it is in my
 * screenshot").
 *
 * Three changes, all from that screenshot:
 *
 * • THE HEADLINE. It read "Downloads" over "All your downloaded content in one
 *   place." — a page title, which is what a web app puts at the top of a route.
 *   It is now the same "Save. Discover. Explore." line and the same
 *   supporting sentence the landing opens with, so a visitor who signs in lands
 *   somewhere continuous with where they came from instead of on a different
 *   product. The words are deliberately IDENTICAL to the landing's; two
 *   near-miss versions of one brand line is worse than either.
 *
 * • NO CARD. The section was a bordered, gradient-washed panel. On the canvas
 *   that reads as a card containing a title, and the reference has the words
 *   sitting directly on the ground with nothing behind them — the ground is what
 *   supplies the depth now, so a wash on top of it just muddies the tint.
 *
 * • The Fast / Secure / Private pill KEEPS its surface, because it is the one
 *   thing here that genuinely is a control-sized object, and it is in the
 *   reference exactly as it was. `backdrop-blur` comes off it: it sits on a flat
 *   canvas, so there is nothing behind it to blur, and it was costing a GPU pass
 *   for no visible effect.
 *
 * The cloud illustration is untouched and still `hidden sm:block` — the owner
 * asked that nothing be removed, and it never rendered on a phone anyway, which
 * is why it is absent from the reference.
 */
export function DownloadsHero() {
  return (
    <section className="relative px-1 pt-1">
      {/*
        🔴 THE TOP GLOW IS GONE (owner, 2026-08-16: "remove the top purple
        gradient on the download page entirely" — the closing word on a
        gradient that went through several rounds of retuning this session
        for a shape/seam/disappearing-on-navigation issue each round. Do not
        re-add it without a fresh, explicit ask.
      */}
      <div className="relative flex items-center gap-4">
        <div className="min-w-0 flex-1">
          {/* The same clamp ramp as the landing H1, so the three words stay on
              one line from a 320px phone up without a single breakpoint. */}
          <h1 className="flex flex-nowrap items-baseline gap-[0.3em] text-[clamp(1.05rem,5.2vw,2.25rem)] font-extrabold leading-[1.1] tracking-[-0.035em] text-slate-900 dark:text-white">
            <span className="whitespace-nowrap">Save.</span>
            <span className="whitespace-nowrap bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
              Discover.
            </span>
            <span className="whitespace-nowrap">Explore.</span>
          </h1>
          <p className="mt-2.5 max-w-md text-pretty text-sm leading-relaxed text-slate-600 dark:text-white/70">
            Save from the platforms you already use, then share, connect and explore — all in{" "}
            <span className="font-medium text-blue-600 dark:text-blue-300">one super app.</span>
          </p>
          {/*
            The trust pills and the streak chip share one row.

            🔴 The chip sits BESIDE the pills, not inside their plate, and it
            renders `null` whenever there is no streak — so this hero is
            byte-for-byte what it was before for a first-time visitor, and the
            H1 above (the LCP element) is untouched either way. A returning
            visitor's chip paints in the first client render from a display
            cache, so it never arrives late and shifts this row. See
            StreakHeroIndicator for why that matters on a page with a 1.6s LCP
            target.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold shadow-[0_2px_10px_-4px_rgba(15,23,42,0.15)] ring-1 ring-inset ring-slate-900/[0.06] dark:bg-white/[0.06] dark:ring-white/10">
              <Pill icon={Zap} label="Fast" />
              <Divider />
              <Pill icon={Lock} label="Secure" />
              <Divider />
              <Pill icon={Shield} label="Private" />
            </span>
            <StreakHeroIndicator />
          </div>
        </div>

        {/* The reference's cloud illustration, drawn rather than shipped as an
            asset — an image here would be dead weight on every load of this page. */}
        <div aria-hidden className="relative hidden h-32 w-32 shrink-0 sm:block">
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/40 to-blue-500/40 blur-2xl" />
          <span className="absolute inset-2 flex items-center justify-center rounded-[2rem] bg-gradient-to-br from-violet-500 to-blue-600 shadow-xl motion-safe:animate-float">
            <CloudDownload className="h-14 w-14 text-white" />
          </span>
          <span className="absolute -left-1 top-2 flex h-9 w-9 items-center justify-center rounded-xl bg-card shadow-md ring-1 ring-border/60">
            <ImageIcon className="h-4 w-4 text-fuchsia-500" />
          </span>
          <span className="absolute -right-1 bottom-3 flex h-9 w-9 items-center justify-center rounded-xl bg-card shadow-md ring-1 ring-border/60">
            <Sparkles className="h-4 w-4 text-blue-500" />
          </span>
        </div>
      </div>
    </section>
  );
}

function Pill({ icon: Icon, label }: { icon: typeof Zap; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5">
      <Icon className="h-3.5 w-3.5 text-primary" /> {label}
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px bg-border" />;
}

/* ───────────────────────────── Cloud storage ─────────────────────────────── */

export function CloudStorageCard({ items }: { items: DownloadRecord[] }) {
  const { plan, isBusiness, ready } = useEntitlements();
  const limit = limitForPlan(plan);
  const uncapped = isBusiness || !Number.isFinite(limit);
  // `estimateBytes` (shared with the quota gate) uses the recorded size when the
  // manager captured one and a per-kind estimate otherwise — so the meter here
  // and the storage ceiling always agree.
  const used = useMemo(() => totalUsedBytes(items), [items]);
  const pct = uncapped || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card p-5 shadow-soft sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Cloud className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold">Cloud storage</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
          <Lock className="h-3 w-3" /> Private &amp; Secure
        </span>
      </div>

      <div className="grid items-center gap-6 sm:grid-cols-[1fr_auto_1fr]">
        {/* Used / limit + bar */}
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-2xl font-extrabold tracking-tight">{formatBytes(used)}</span>
            <span className="text-sm text-muted-foreground">/ {uncapped ? "∞ Unlimited" : formatBytes(limit)}</span>
          </p>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-600 transition-all"
              style={{ width: `${uncapped ? 100 : pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{uncapped ? "No cap on your plan" : `${pct}% used`}</p>
        </div>

        {/* Ring gauge */}
        <Gauge pct={uncapped ? 100 : pct} label={formatBytes(used)} />

        {/* Benefits */}
        <div className="relative min-w-0">
          <Shield aria-hidden className="pointer-events-none absolute -right-2 bottom-0 h-16 w-16 text-muted-foreground/10" />
          <p className="text-sm font-bold">{uncapped ? "Unlimited storage" : ready ? `${formatBytes(limit)} of storage` : "Your storage"}</p>
          <ul className="mt-2 space-y-1.5">
            {[
              uncapped ? "No download limits" : "Downloads never expire",
              "Secure cloud backup",
              "Access anywhere",
              "100% private",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 shrink-0 text-blue-500" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** SVG ring — no chart library for one gauge. */
function Gauge({ pct, label }: { pct: number; label: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-32 w-32 shrink-0">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" strokeWidth="9" className="stroke-secondary" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          stroke="url(#storageRing)"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.max(2, pct) / 100) * c}
        />
        <defs>
          <linearGradient id="storageRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(37 99 235)" />
            <stop offset="100%" stopColor="rgb(124 58 237)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-extrabold tracking-tight">{label}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Used</span>
      </span>
    </div>
  );
}

/* ─────────────────────────────── Stat tiles ──────────────────────────────── */

export function DownloadStats({ items }: { items: DownloadRecord[] }) {
  const stats = useMemo(() => {
    const total = items.length;
    const bytes = items.reduce((n, r) => n + estimateBytes(r), 0);
    const favorites = items.filter((r) => r.favorite).length;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = items.filter((r) => r.createdAt >= midnight.getTime()).length;
    return { total, bytes, favorites, today, avg: total > 0 ? bytes / total : 0 };
  }, [items]);

  const tiles = [
    { icon: Download, tint: "text-blue-500 bg-blue-500/12", value: formatCompactNumber(stats.total), label: "Total downloads", sub: "All time" },
    { icon: HardDrive, tint: "text-violet-500 bg-violet-500/12", value: formatBytes(stats.bytes), label: "Total size", sub: stats.total > 0 ? `Avg. ${formatBytes(stats.avg)}` : "Nothing saved yet" },
    { icon: Heart, tint: "text-rose-500 bg-rose-500/12", value: formatCompactNumber(stats.favorites), label: "Favorites", sub: "Saved items" },
    { icon: Flame, tint: "text-emerald-500 bg-emerald-500/12", value: formatCompactNumber(stats.today), label: "Downloaded today", sub: stats.today > 0 ? "Keep it up" : "Nothing yet today" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", t.tint)}>
            <t.icon className="h-5 w-5" />
          </span>
          <p className="mt-3 text-2xl font-extrabold tracking-tight">{t.value}</p>
          <p className="text-xs font-semibold">{t.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── Recent downloads ──────────────────────────── */

export function RecentDownloads({ items }: { items: DownloadRecord[] }) {
  const recent = items.slice(0, 4);
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">Recent downloads</h2>
        {/* Opens the dedicated history page. `prefetch` warms the route while
            this section is on screen, so the tap is an instant transition rather
            than a load (owner). */}
        <Link href="/history" prefetch className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        {recent.map((r) => {
          const Brand = BRAND_ICONS[r.platform];
          return (
            <article key={r.id} className="w-40 shrink-0 sm:w-auto">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-800">
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : null}
                {Brand ? (
                  <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur-md">
                    <Brand className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {r.qualityLabel}
                </span>
              </div>
              <div className="mt-2 flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatBytes(estimateBytes(r))} · {relativeTime(r.createdAt)}
                  </p>
                </div>
                <MoreVertical aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

/* ───────────────────────────── Quick actions ─────────────────────────────── */

/**
 * The reference's four action cards. Only the ones with a real destination are
 * links; the product-ecosystem entries that have no route yet are marked "Soon"
 * rather than shipped as buttons that 404 (the profile-doorway rule).
 */
export function DownloadQuickActions() {
  const cards: { icon: typeof Sparkles; tint: string; title: string; sub: string; href?: string; soon?: boolean }[] = [
    // "Browse full screen" means exactly that, so it skips the grid and opens
    // the reels viewer directly (`?reels=1`) — the behaviour this card has
    // always had, kept on the one wallpaper route.
    { icon: ImageIcon, tint: "text-fuchsia-500 bg-fuchsia-500/12", title: "Wallpapers", sub: "Browse full screen", href: "/wallpapers?reels=1" },
    { icon: Heart, tint: "text-rose-500 bg-rose-500/12", title: "Favorites", sub: "View saved items", href: "/history?filter=favorites" },
    { icon: Bookmark, tint: "text-blue-500 bg-blue-500/12", title: "Saved posts", sub: "Your bookmarks", href: "/saved" },
    { icon: Sparkles, tint: "text-violet-500 bg-violet-500/12", title: "AI Studio", sub: "Edit your media", soon: true },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const inner = (
          <>
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", c.tint)}>
              <c.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-bold">{c.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{c.sub}</span>
            </span>
            {c.soon ? (
              <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            ) : null}
          </>
        );
        const cls = "flex items-center gap-2.5 rounded-2xl border border-border/60 bg-card p-3 shadow-soft transition hover:border-foreground/15";
        if (c.href) {
          return (
            <Link key={c.title} href={c.href} prefetch className={cls}>
              {inner}
            </Link>
          );
        }
        return (
          <div key={c.title} className={cn(cls, "opacity-75")}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── Trust strip ─────────────────────────────── */

/**
 * The reference closed with "2M+ Downloads" and "120K+ Happy users". Those are
 * numbers we do not have, and inventing them is the one thing the owner has
 * ruled out repeatedly. This states the four guarantees instead — every one of
 * which is a property of the product that can be checked.
 */
export function DownloadTrustStrip() {
  const items = [
    { icon: Zap, tint: "text-amber-500", title: "Ultra fast", sub: "Streamed straight to you" },
    { icon: ShieldCheck, tint: "text-emerald-500", title: "100% secure", sub: "Your privacy first" },
    { icon: Lock, tint: "text-blue-500", title: "No account needed", sub: "To download and go" },
    { icon: Cloud, tint: "text-violet-500", title: "Watermark free", sub: "Original quality" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 rounded-3xl border border-border/60 bg-card p-4 shadow-soft lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.title} className="flex items-center gap-2.5">
          <i.icon className={cn("h-5 w-5 shrink-0", i.tint)} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{i.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{i.sub}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
