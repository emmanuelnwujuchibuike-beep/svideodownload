"use client";

import {
  CalendarClock,
  Crown,
  Download,
  HardDrive,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Music,
  Trash2,
  TrendingUp,
  Video,
} from "lucide-react";
import Link from "next/link";
import { type ComponentType, useMemo, useState } from "react";

import { useUser } from "@/features/auth/use-user";
import { useHistory } from "@/features/history/use-history";
import { computeUsage, GUEST_LIMIT_BYTES } from "@/features/history/usage";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { MediaKind } from "@/types";
import { cn, formatBytes } from "@/lib/utils";

const KIND_ICON: Record<MediaKind, ComponentType<{ className?: string }>> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
};

const KIND_TINT: Record<string, { bar: string; text: string }> = {
  video: { bar: "bg-violet-500", text: "text-violet-500" },
  audio: { bar: "bg-emerald-500", text: "text-emerald-500" },
  image: { bar: "bg-amber-500", text: "text-amber-500" },
};

/**
 * Usage analytics + the 5 GB quota meter for the on-device download library.
 *
 * Reads the local history store (features/history/store.ts) through the pure
 * `computeUsage` roll-up, so every number here is measured from real records —
 * never a fabricated allowance (the storage rail's old "128 GB" invention is the
 * anti-pattern this avoids). Signed-in visitors are uncapped and see a synced,
 * unlimited framing; signed-out visitors see the 5 GB meter and, once near or
 * over it, the upgrade-or-clear gate.
 */
export function UsageDashboard({ onClearHistory }: { onClearHistory?: () => void } = {}) {
  const { user, loading } = useUser();
  const { items, clearHistory } = useHistory();
  const [confirmClear, setConfirmClear] = useState(false);

  // Signed-in users are never gated — their limit is lifted. While auth is still
  // resolving we assume the guest cap so a signed-in reload never flashes the
  // gate; `loading` guards the copy below.
  const signedIn = !!user;
  const usage = useMemo(
    () => computeUsage(items, signedIn ? Infinity : GUEST_LIMIT_BYTES),
    [items, signedIn],
  );

  const clear = () => {
    clearHistory();
    onClearHistory?.();
    setConfirmClear(false);
  };

  return (
    <section aria-label="Download usage" className="space-y-4">
      {/* Storage meter — the headline. */}
      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card p-5 shadow-soft sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <HardDrive className="h-4 w-4 text-primary" /> Storage used
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {signedIn
                ? "Synced to your account across every device."
                : "Saved privately on this device."}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-extrabold tabular-nums leading-none">{formatBytes(usage.usedBytes)}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {signedIn ? (
                <span className="inline-flex items-center gap-1">
                  of <InfinityIcon className="h-3.5 w-3.5" /> unlimited
                </span>
              ) : (
                `of ${formatBytes(GUEST_LIMIT_BYTES)}`
              )}
            </p>
          </div>
        </div>

        {/* The bar is only meaningful against a real ceiling. */}
        {signedIn ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3.5 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <Crown className="h-4 w-4" /> Unlimited storage — no download limits on your account.
          </div>
        ) : (
          <div className="mt-4">
            <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  usage.overLimit
                    ? "bg-gradient-to-r from-rose-500 to-red-600"
                    : usage.nearLimit
                      ? "bg-gradient-to-r from-amber-500 to-orange-600"
                      : "bg-gradient-to-r from-blue-500 to-violet-600",
                )}
                style={{ width: `${Math.max(usage.count > 0 ? 2 : 0, usage.percentUsed)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
              <span>{usage.percentUsed}% used</span>
              <span>{formatBytes(usage.remainingBytes)} free</span>
            </div>
          </div>
        )}
      </div>

      {/* The gate — only for signed-out visitors near or over the ceiling. */}
      {!signedIn && !loading && (usage.overLimit || usage.nearLimit) ? (
        <div
          className={cn(
            "rounded-3xl border p-5 shadow-soft",
            usage.overLimit
              ? "border-rose-500/30 bg-rose-500/[0.06]"
              : "border-amber-500/30 bg-amber-500/[0.06]",
          )}
        >
          <p className="text-sm font-bold">
            {usage.overLimit
              ? "You've reached your 5 GB free limit"
              : `You're at ${usage.percentUsed}% of your 5 GB free limit`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {usage.overLimit
              ? "Sign in to upgrade to Pro for unlimited storage, or clear history to keep downloading."
              : "Sign in to upgrade to Pro for unlimited storage before you run out of space."}
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <Link
              href="/login?next=/pricing"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.98]"
            >
              <Crown className="h-4 w-4" /> Upgrade to Pro
            </Link>
            {confirmClear ? (
              <span className="inline-flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-xl bg-rose-500/10 px-3 py-2.5 font-semibold text-rose-500 transition hover:bg-rose-500/20"
                >
                  Yes, clear all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-2.5 font-medium text-muted-foreground transition hover:text-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-500 active:scale-[0.98]"
              >
                <Trash2 className="h-4 w-4" /> Clear history
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Analytics — real figures from the local records. Hidden until there is
          at least one download, so a fresh library is not four zeros. */}
      {usage.count > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={Download} tint="text-violet-500" label="Downloads" value={usage.count.toLocaleString()} sub="All time" />
            <Stat icon={HardDrive} tint="text-cyan-500" label="Total size" value={formatBytes(usage.usedBytes)} sub={`avg ${formatBytes(usage.averageBytes)}`} />
            <Stat icon={CalendarClock} tint="text-blue-500" label="This week" value={usage.thisWeekCount.toLocaleString()} sub={usage.thisWeekBytes > 0 ? formatBytes(usage.thisWeekBytes) : "—"} />
            <Stat
              icon={TrendingUp}
              tint="text-emerald-500"
              label="Top source"
              value={usage.topPlatform?.label ?? "—"}
              sub={usage.topPlatform ? `${usage.topPlatform.count} saved` : "—"}
              brand={usage.topPlatform?.key}
            />
          </div>

          {/* Composition by media type — a labelled proportional bar. */}
          <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
            <h3 className="text-sm font-bold">By type</h3>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-secondary">
              {usage.byKind.map((k) => (
                <div
                  key={k.key}
                  className={cn("h-full", KIND_TINT[k.key]?.bar ?? "bg-muted-foreground")}
                  style={{ width: `${(k.bytes / usage.usedBytes) * 100}%` }}
                  title={`${k.label}: ${formatBytes(k.bytes)}`}
                />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {usage.byKind.map((k) => {
                const Icon = KIND_ICON[k.key as MediaKind] ?? Video;
                return (
                  <li key={k.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn("h-3.5 w-3.5", KIND_TINT[k.key]?.text ?? "text-muted-foreground")} />
                      {k.label}
                      <span className="text-muted-foreground/70">· {k.count}</span>
                    </span>
                    <span className="font-medium tabular-nums text-muted-foreground">{formatBytes(k.bytes)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Stat({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  brand,
}: {
  icon: ComponentType<{ className?: string }>;
  tint: string;
  label: string;
  value: string;
  sub: string;
  brand?: string;
}) {
  const Brand = brand ? BRAND_ICONS[brand as keyof typeof BRAND_ICONS] : null;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-secondary", tint)}>
        {Brand ? <Brand className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <p className="mt-3 truncate text-lg font-extrabold tabular-nums">{value}</p>
      <p className="truncate text-xs font-medium text-foreground">{label}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
