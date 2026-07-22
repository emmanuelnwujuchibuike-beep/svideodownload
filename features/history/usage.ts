import type { BillingPlan } from "@/lib/monetization/types";
import type { DownloadRecord, MediaKind, PlatformId } from "@/types";

/**
 * Download-usage analytics + the guest storage quota — the single source of
 * truth for "how much has this device downloaded and how close is it to the
 * free limit".
 *
 * Everything here is PURE (no React, no `window`) so it runs identically on the
 * server, in `useSyncExternalStore` selectors, and in vitest. The download
 * history already lives locally (features/history/store.ts); this turns that
 * list into the numbers the guest library and the download gate both read, so
 * they can never disagree about the used total or the limit.
 *
 * ── Why a quota at all ────────────────────────────────────────────────────────
 * A signed-out visitor's history is device-local and unbounded, which is fine
 * until it is not: at some point the honest move is to ask them to make an
 * account (which syncs their library across devices and lifts the cap) rather
 * than silently accumulating forever. 5 GB is the free ceiling; past it a guest
 * either signs in to upgrade or clears space. Signed-in users are never gated
 * here — their limit is lifted by the caller passing `Infinity`.
 */

/** Reels are small; platform is the best signal we have when a record predates
 *  exact-size tracking. Kept in sync with the download manager's own list. */
const REEL_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "snapchat"];

/**
 * The storage ceiling per plan.
 *
 * Free (and every signed-out visitor) gets 5 GB; Pro gets 59 GB; Business is
 * uncapped. These are the numbers the meter shows and the gate enforces, so the
 * download button and the usage page can never disagree about a plan's limit.
 */
export const PLAN_LIMIT_BYTES: Record<BillingPlan, number> = {
  free: 5 * 1024 ** 3,
  pro: 59 * 1024 ** 3,
  business: Infinity,
};

/** The storage ceiling for a plan (guests are treated as free). */
export function limitForPlan(plan: BillingPlan): number {
  return PLAN_LIMIT_BYTES[plan] ?? PLAN_LIMIT_BYTES.free;
}

/** The free / signed-out ceiling: 5 GB (binary, matching `formatBytes`). */
export const GUEST_LIMIT_BYTES = PLAN_LIMIT_BYTES.free;

/** Fraction of the limit at which we start warning before the hard block. */
export const NEAR_LIMIT_FRACTION = 0.8;

/**
 * Exact recorded size when the manager captured it; otherwise a representative
 * estimate by media kind / platform. This is the ONE definition — the downloads
 * dashboard, the storage rail and the guest quota all import it, so a records's
 * weight is identical everywhere it is counted.
 */
export function estimateBytes(rec: Pick<DownloadRecord, "size" | "kind" | "platform">): number {
  if (rec.size && rec.size > 0) return rec.size;
  if (rec.kind === "audio") return 5 * 1024 * 1024;
  if (rec.kind === "image") return 2 * 1024 * 1024;
  if (REEL_PLATFORMS.includes(rec.platform)) return 12 * 1024 * 1024;
  return 38 * 1024 * 1024;
}

/**
 * Just the total — a cheap sum for the download gate, which only needs to know
 * whether the ceiling is crossed. Importing this instead of `computeUsage` keeps
 * the full analytics (and its Maps) out of the landing page's initial bundle,
 * which the 2-second budget cannot afford.
 */
export function totalUsedBytes(items: readonly DownloadRecord[]): number {
  let total = 0;
  for (const rec of items) total += estimateBytes(rec);
  return total;
}

export interface UsageBreakdownEntry {
  key: string;
  label: string;
  bytes: number;
  count: number;
}

export interface UsageStats {
  /** Number of downloads recorded on this device. */
  count: number;
  /** Total bytes used (exact where known, estimated otherwise). */
  usedBytes: number;
  /** The ceiling this usage is measured against (Infinity for signed-in users). */
  limitBytes: number;
  /** Bytes left before the limit (0 when over, Infinity when uncapped). */
  remainingBytes: number;
  /** 0–100, capped for display. NaN-safe: an uncapped limit reports 0. */
  percentUsed: number;
  /** At or past the limit — new downloads should be gated. */
  overLimit: boolean;
  /** In the warning band (≥80% and not yet over). */
  nearLimit: boolean;
  /** Composition by media kind, largest first. */
  byKind: UsageBreakdownEntry[];
  /** Composition by source platform, largest first. */
  byPlatform: UsageBreakdownEntry[];
  /** The single heaviest platform, or null for an empty library. */
  topPlatform: UsageBreakdownEntry | null;
  /** Oldest / newest download timestamps (ms), or null when empty. */
  firstAt: number | null;
  lastAt: number | null;
  /** Activity in the trailing 7 days. */
  thisWeekCount: number;
  thisWeekBytes: number;
  /** Mean bytes per download (0 when empty). */
  averageBytes: number;
}

const KIND_LABEL: Record<MediaKind, string> = {
  video: "Videos",
  audio: "Audio",
  image: "Images",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Roll a history list up into the usage figures the UI reads. Defaults to the
 * guest limit; pass `Infinity` for signed-in users (never gated) or any ceiling
 * for tests.
 */
export function computeUsage(
  items: readonly DownloadRecord[],
  limitBytes: number = GUEST_LIMIT_BYTES,
  now: number = Date.now(),
): UsageStats {
  const kindMap = new Map<string, UsageBreakdownEntry>();
  const platformMap = new Map<string, UsageBreakdownEntry>();

  let usedBytes = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let thisWeekCount = 0;
  let thisWeekBytes = 0;

  for (const rec of items) {
    const bytes = estimateBytes(rec);
    usedBytes += bytes;

    const k = kindMap.get(rec.kind) ?? { key: rec.kind, label: KIND_LABEL[rec.kind] ?? rec.kind, bytes: 0, count: 0 };
    k.bytes += bytes;
    k.count += 1;
    kindMap.set(rec.kind, k);

    const p = platformMap.get(rec.platform) ?? { key: rec.platform, label: rec.platformName || rec.platform, bytes: 0, count: 0 };
    p.bytes += bytes;
    p.count += 1;
    platformMap.set(rec.platform, p);

    if (firstAt === null || rec.createdAt < firstAt) firstAt = rec.createdAt;
    if (lastAt === null || rec.createdAt > lastAt) lastAt = rec.createdAt;
    if (now - rec.createdAt <= WEEK_MS) {
      thisWeekCount += 1;
      thisWeekBytes += bytes;
    }
  }

  const capped = Number.isFinite(limitBytes);
  const remainingBytes = capped ? Math.max(0, limitBytes - usedBytes) : Infinity;
  const percentUsed = capped && limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  const overLimit = capped && usedBytes >= limitBytes;
  const nearLimit = capped && !overLimit && usedBytes >= limitBytes * NEAR_LIMIT_FRACTION;

  const byBytes = (a: UsageBreakdownEntry, b: UsageBreakdownEntry) => b.bytes - a.bytes;
  const byKind = [...kindMap.values()].sort(byBytes);
  const byPlatform = [...platformMap.values()].sort(byBytes);

  return {
    count: items.length,
    usedBytes,
    limitBytes,
    remainingBytes,
    percentUsed,
    overLimit,
    nearLimit,
    byKind,
    byPlatform,
    topPlatform: byPlatform[0] ?? null,
    firstAt,
    lastAt,
    thisWeekCount,
    thisWeekBytes,
    averageBytes: items.length > 0 ? Math.round(usedBytes / items.length) : 0,
  };
}
