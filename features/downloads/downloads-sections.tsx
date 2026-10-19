"use client";

import {
  Check,
  Cloud,
  CloudDownload,
  Download,
  Flame,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Lock,
  Shield,
  Music,
} from "lucide-react";
import { useMemo } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { estimateBytes, limitForPlan, totalUsedBytes } from "@/features/history/usage";
import type { DownloadRecord } from "@/types";
import type { ReactNode } from "react";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";

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
export function DownloadsHero({ trailing, headline = true, subtitle = true }: { trailing?: ReactNode; headline?: boolean; subtitle?: boolean } = {}) {
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
          {/*
            The headline row carries an optional right-hand slot (owner, 2026-10-08:
            "move it to the right opposite the save, discover, create so it doesn't
            push it downward") — the landing's Earn pill. `min-w-0` on the H1 side
            and `shrink-0` on the slot keep the three words on one line.
          */}
          {/*
            /downloads drops the headline and its line (owner, 2026-10-08: "remove the
            section from the Download page alone") — the landing keeps them. The page
            still has its H1, for screen readers and search, just not on screen.
          */}
          {headline ? (
            <>
              <div className="flex items-center justify-between gap-2">
                {/*
                  "Create and earn." (owner 2026-10-14) is longer, and on /downloads the line shares its row
                  with Earn or Promote. So the H1 takes the space left beside them (flex-1, a size
                  container) and the words are sized to that width (cqw): one line, never under the
                  button. Below a readable floor (a 320px phone beside Earn) "Create and earn." wraps to a second
                  line rather than overflow. Older browsers without container units keep the viewport-based size.
                */}
                <h1 className="min-w-0 flex-1 [container-type:inline-size]">
                  <span className="flex flex-wrap items-baseline gap-x-[0.3em] text-[clamp(1rem,4.2vw,2.25rem)] font-extrabold leading-[1.1] tracking-[-0.035em] text-slate-900 [@supports(width:1cqw)]:text-[clamp(1rem,calc(100cqw/15.6),2.25rem)] dark:text-white">
                    <span className="whitespace-nowrap">Save.</span>
                    <span className="whitespace-nowrap bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
                      Discover.
                    </span>
                    {/* the third words name Frenz AI and the credits people earn (Landing + Download brief §4, owner 2026-10-08 / 2026-10-14) */}
                    <span className="whitespace-nowrap">Create and earn.</span>
                  </span>
                </h1>
                {/* inset to the header's right-hand controls above it (owner, 2026-10-08: "shift too far out of the edge") */}
                {trailing ? <div className="mr-3 shrink-0">{trailing}</div> : null}
              </div>
              {/* /downloads keeps the line but not this paragraph (owner, 2026-10-08 / 2026-10-09) */}
              {subtitle ? (
              <p className="mt-2.5 max-w-md text-pretty text-sm leading-relaxed text-slate-600 dark:text-white/70">
                Save from the platforms you already use, discover what people share, and create with AI — all in{" "}
                <span className="font-medium text-blue-600 dark:text-blue-300">one super app.</span>
              </p>
              ) : null}
            </>
          ) : (
            <h1 className="sr-only">Download</h1>
          )}
          {/*
            The trust pills, alone on their row again.

            ⚠️ The streak chip used to sit here beside them. It moved to the
            HEADER on 2026-09-08 (owner: "Streak in Header (Compact) — clean,
            compact and always visible without taking focus from the main
            action") — see features/streaks/streak-header-chip.tsx.

            The reasoning was sound and the placement was not: this row is
            directly under the H1, which is the LCP element and the most
            valuable space on a page whose entire job is the paste box below it.
            A returning-visitor detail does not belong there. In the header it
            is on every route instead of two, and in the way on none.
          */}
          {/*
            Owner, 2026-09-20: the Quick actions button sits OPPOSITE the
            trust pill on this row — `justify-between`, and the row still
            wraps, so on the narrowest phone the button drops to its own line
            rather than pressing into the pill. Same row on the landing page and
            on /downloads, because this hero IS both.

            2026-09-27 (owner): "Remove the quick action button from the landing
            page and Download page." The trust pills now sit alone — the quick
            actions they shared the row with are still on /downloads as the card
            grid below (DownloadQuickActions), which is a different thing: a
            visible set of destinations rather than a button that opened a sheet
            over them.
          */}
          {/*
            2026-10-08 (owner): "replace this fast secure private card with the
            promote card, and move the fast secure private downward" — the pill is
            now `TrustPills`, rendered under the paste box (download-page-core).
          */}
          {/* The Promote button is no longer here: it is fixed beside the credits card on
              /downloads and beside "Install Frenz" in the landing header (owner,
              2026-10-09: "remove the movement") — see promote-button.tsx. */}
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
            <Music className="h-4 w-4 text-blue-500" />
          </span>
        </div>
      </div>
    </section>
  );
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
