"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { RotatingWallpaperLayers } from "@/components/wallpapers/wallpaper-cta-rotator";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { AiPromoLoader } from "@/features/downloads/ai-promo-loader";
import { ReportFailureButton } from "@/features/downloads/report-failure-button";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import type { DownloadTask } from "@/features/downloads/manager";
import {
  ChevronRightIcon,
  CloudIcon,
  CoinIcon,
  CompassIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
} from "@/features/frenz-ui/icons";
import { Card } from "@/features/frenz-ui/primitives";
import { totalUsedBytes, limitForPlan } from "@/features/history/usage";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { promoStages, type AiPromo } from "@/lib/ai/promo/config";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { cn, formatBytes } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

/*
  The redesigned Home / Download screen's own sections (design/Main.dc.html,
  2026-10-18). White page, white cards with the hairline; the brand gradient
  only on the two showcase cards (Frenz AI, Wallpapers), progress, and badges.
  Lightweight by rule: no animation library, the usage detail and the promo
  media load only when needed.
*/

const UsageDashboard = dynamic(() => import("@/features/downloads/usage-dashboard").then((m) => m.UsageDashboard), { ssr: false });

/** The existing H1 and its line (owner: "it should be all the hero H1 that is already existed"), in the display face. */
export function HomeHero() {
  return (
    <section className="px-1 pt-1">
      <h1 className="font-display text-[clamp(1.85rem,9vw,2.75rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-frenz-ink">
        <span className="block">
          Save. <span className="text-frenz-violet">Discover.</span>
        </span>
        <span className="block">Create and earn.</span>
      </h1>
      <p className="mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-frenz-muted">
        Save from the platforms you already use, discover what people share, and create with AI — all in{" "}
        <span className="font-semibold text-frenz-ink">one super app.</span>
      </p>
    </section>
  );
}

/* ───────────────────────────── Live downloads ───────────────────────────── */

const LIVE: DownloadTask["status"][] = ["queued", "preparing", "downloading", "paused", "failed"];

function statusLine(t: DownloadTask, pct: number | null): string {
  switch (t.status) {
    case "failed":
      return t.error ? `Couldn’t save — ${t.error}` : "Couldn’t save";
    case "paused":
      return "Paused";
    case "queued":
      return "Queued…";
    case "preparing":
      return "Preparing file…";
    default:
      return pct === null ? `${formatBytes(t.receivedBytes)}` : `${formatBytes(t.receivedBytes)} of ${formatBytes(t.totalBytes)}`;
  }
}

/**
 * Transfers in flight: in progress, paused, and failed with Retry — the design's row states.
 * Finished saves leave this list for History (owner: "the recent section … should be in history").
 * Renders nothing when nothing is moving.
 */
export function LiveDownloads() {
  const { tasks, pauseDownload, resumeDownload, retryDownload, cancelDownload, pauseAll } = useDownloadManager();
  const live = tasks.filter((t) => LIVE.includes(t.status));
  if (live.length === 0) return null;
  const anyRunning = live.some((t) => t.status === "downloading" || t.status === "queued" || t.status === "preparing");

  return (
    <section aria-labelledby="home-downloading">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-[26px]">
        <h2 id="home-downloading" className="m-0 font-heading text-xl font-bold tracking-[-0.5px] text-frenz-ink">
          Downloading
        </h2>
        {anyRunning ? (
          <button type="button" onClick={pauseAll} className="min-h-11 text-sm font-bold text-frenz-blue hover:text-frenz-violet">
            Pause all
          </button>
        ) : null}
      </div>
      <Card as="ul" className="overflow-hidden">
        {live.map((t, i) => {
          const pct = t.totalBytes > 0 ? Math.min(100, Math.round((t.receivedBytes / t.totalBytes) * 100)) : null;
          const Brand = BRAND_ICONS[t.platform];
          const failed = t.status === "failed";
          return (
            <li key={t.id} className={cn("flex items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-frenz-line")}>
              <span aria-hidden className="relative flex h-16 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-frenz-ink/80 text-white">
                {t.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                ) : (
                  <PlayIcon size={14} />
                )}
                {Brand ? (
                  <span className="absolute bottom-1 left-1 text-white/90">
                    <Brand className="h-3 w-3" />
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="truncate text-[15px] font-bold text-frenz-ink">{t.title}</span>
                <span className={cn("truncate text-[13px]", failed ? "text-rose-700" : "text-frenz-muted")}>
                  {t.platformName} · {statusLine(t, pct)}
                </span>
                {!failed ? (
                  <span className="mt-[3px] flex items-center gap-2">
                    <span
                      role="progressbar"
                      aria-label={`${t.title} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct ?? undefined}
                      className="h-[5px] flex-1 overflow-hidden rounded-full bg-frenz-fill"
                    >
                      <span className="block h-full rounded-full bg-frenz-gradient-x transition-[width] duration-300" style={{ width: `${pct ?? 0}%` }} />
                    </span>
                    {pct !== null ? <span className="text-xs font-bold tabular-nums text-frenz-violet">{pct}%</span> : null}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {failed ? (
                  <>
                    <button
                      type="button"
                      onClick={() => retryDownload(t.id)}
                      className="relative h-[34px] rounded-full bg-rose-50 px-3 text-[13px] font-bold text-rose-700 active:scale-95 before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']"
                    >
                      Retry
                    </button>
                    <ReportFailureButton
                      url={t.url}
                      platform={t.platform}
                      formatId={t.formatId}
                      kind={t.kind}
                      title={t.title}
                      errorMessage={t.error}
                      surface="downloads-page"
                    />
                  </>
                ) : t.status === "paused" ? (
                  <RoundButton label="Resume download" onClick={() => resumeDownload(t.id)}>
                    <PlayIcon size={16} />
                  </RoundButton>
                ) : (
                  <RoundButton label="Pause download" onClick={() => pauseDownload(t.id)}>
                    <PauseIcon size={16} />
                  </RoundButton>
                )}
                <button
                  type="button"
                  onClick={() => cancelDownload(t.id)}
                  aria-label="Cancel download"
                  className="flex h-11 w-8 items-center justify-center rounded-full text-frenz-muted active:scale-90"
                >
                  <X className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </Card>
    </section>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-full bg-frenz-violet/10 text-frenz-violet transition active:scale-90 before:absolute before:-inset-0.5 before:content-['']"
    >
      {children}
    </button>
  );
}

/* ───────────────────────────────── Tools ───────────────────────────────── */

const SHOWCASE =
  "relative flex h-[150px] flex-col justify-end gap-0.5 overflow-hidden rounded-[22px] p-3.5 text-white no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2";

/**
 * Where Recent used to be (owner, 2026-10-18: "use that section to put the earning, ai and exclusive
 * feature"): the two showcase cards the design draws — Frenz AI and Wallpapers, the only places the
 * gradient fills a card — then Earn and Exclusive as plain white cards, and Explore under them.
 * Every word is the app's existing copy for each door.
 */
export function HomeTools({ aiPromo, rotateUrls }: { aiPromo: AiPromo | null; rotateUrls: string[] }) {
  const playsPromo = !!aiPromo && promoStages(aiPromo).length > 1;
  return (
    <section aria-labelledby="home-tools">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-[26px]">
        <h2 id="home-tools" className="m-0 font-heading text-xl font-bold tracking-[-0.5px] text-frenz-ink">
          Tools
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* Frenz AI keeps Next's viewport prefetch (owner, 2026-09-09: it must open on one tap) and its promotion media. */}
        <Link
          href="/ai"
          data-track="ai_clicked"
          className={cn(SHOWCASE, "bg-[radial-gradient(circle_at_75%_20%,hsl(var(--frenz-magenta)),hsl(var(--frenz-violet))_40%,hsl(var(--frenz-ink))_92%)]")}
        >
          {playsPromo ? <AiPromoLoader promo={aiPromo!} /> : null}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
          <span className="relative font-heading text-[17px] font-bold">Frenz AI</span>
          <span className="relative text-[13px] leading-snug text-white/85">Create amazing videos with AI</span>
        </Link>
        <Link
          href="/wallpapers"
          data-track="wallpapers_clicked"
          className={cn(SHOWCASE, "bg-[radial-gradient(circle_at_30%_20%,hsl(var(--frenz-blue)),hsl(var(--frenz-violet))_45%,hsl(var(--frenz-ink))_92%)]")}
        >
          {rotateUrls.length > 1 ? <RotatingWallpaperLayers urls={rotateUrls} sizes="50vw" /> : null}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
          <span className="relative font-heading text-[17px] font-bold">Wallpapers</span>
          <span className="relative text-[13px] leading-snug text-white/85">HD wallpapers for your screen</span>
        </Link>
        <ToolCard href="/quests" warm icon={<CoinIcon size={18} />} title="Earn" sub="Turn activity into rewards" />
        <ToolCard href="/exclusive" icon={<LockIcon size={18} />} title="Exclusive" sub="Posts from creators you subscribe to." />
      </div>
      <RowCard href="/explore" icon={<CompassIcon size={22} />} title="Explore" sub="Discover trending content" className="mt-3" />
    </section>
  );
}

function ToolCard({ href, icon, title, sub, warm = false }: { href: string; icon: ReactNode; title: string; sub: string; warm?: boolean }) {
  return (
    <TapOnceLink
      href={href}
      prefetch={false}
      spinner={false}
      warmOnIdle={warm}
      className="flex min-h-[104px] flex-col justify-between gap-2 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 text-frenz-ink no-underline shadow-frenz-card transition active:scale-[0.98] data-[pending]:opacity-70"
    >
      <span aria-hidden className="flex h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-frenz-violet/10 text-frenz-violet">
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-[15px] font-bold">{title}</span>
        <span className="text-xs leading-snug text-frenz-muted">{sub}</span>
      </span>
    </TapOnceLink>
  );
}

function RowCard({ href, icon, title, sub, className }: { href: string; icon: ReactNode; title: string; sub: string; className?: string }) {
  return (
    <TapOnceLink
      href={href}
      prefetch={false}
      spinner={false}
      className={cn(
        "flex items-center gap-3 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 text-frenz-ink no-underline shadow-frenz-card transition active:scale-[0.99] data-[pending]:opacity-70",
        className,
      )}
    >
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold">{title}</span>
        <span className="truncate text-[13px] text-frenz-muted">{sub}</span>
      </span>
      <ChevronRightIcon size={16} strokeWidth={2.4} className="shrink-0 text-frenz-muted" />
    </TapOnceLink>
  );
}

/* ───────────────────────────── Cloud storage ───────────────────────────── */

/**
 * The design's Cloud storage row, with the real figures (bytes on this device's library against the
 * plan's ceiling). Tapping opens the existing usage detail inline — the breakdown, the upgrade-or-clear
 * gate — which is only fetched then.
 */
export function StorageRow({ items }: { items: DownloadRecord[] }) {
  const { plan, isBusiness, ready } = useEntitlements();
  const [open, setOpen] = useState(false);
  const limit = limitForPlan(plan);
  const uncapped = isBusiness || !Number.isFinite(limit);
  const used = useMemo(() => totalUsedBytes(items), [items]);
  // formatBytes(0) is "—"; an empty library is a real 0, said as one
  const usedText = used > 0 ? formatBytes(used) : "0 MB";
  const line = !ready ? `${usedText} used` : uncapped ? `${usedText} used · Unlimited` : `${usedText} of ${formatBytes(limit)} used`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="home-storage-detail"
        className="flex w-full items-center gap-3 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 text-left text-frenz-ink shadow-frenz-card transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
      >
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-blue/10 text-frenz-blue">
          <CloudIcon size={22} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-bold">Cloud storage</span>
          <span className="truncate text-[13px] text-frenz-muted">{line}</span>
        </span>
        <ChevronRightIcon size={16} strokeWidth={2.4} className={cn("shrink-0 text-frenz-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      <div id="home-storage-detail">{open ? <div className="mt-3"><UsageDashboard /></div> : null}</div>
    </div>
  );
}
