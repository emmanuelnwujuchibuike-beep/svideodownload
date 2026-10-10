"use client";

import { useUser } from "@/features/auth/use-user";
import { mutate, revalidate, useQuery } from "@/features/data";

/**
 * The advertiser dashboard's reads, on the app's shared stale-while-revalidate
 * cache — the same one the AI balance uses (owner, 2026-10-09: "the user
 * dashboard reloads every time on every entry and every back-swipe; it is
 * supposed to cache like the AI balance and only revalidate when there is new
 * data").
 *
 *   · entering a tab or swiping back paints the cached figures at once — no
 *     skeleton, no request — while they are under a minute old;
 *   · older than that, they still paint at once and are re-read quietly in the
 *     background; the numbers change only if the database's did;
 *   · focus and back-swipe (bfcache) never trigger a re-read on their own;
 *   · an action the advertiser takes (remove, pause, edit, replace, extend)
 *     calls `refreshAdDashboard()`, which re-reads every section now.
 *
 * Keys carry the signed-in user's id, so one account never sees another's
 * cached figures on a shared device.
 */
export const DASH_FRESH_MS = 60_000;

const fetchers = new Map<string, () => Promise<unknown>>();

export function useDash<T>(key: string, fetcher: () => Promise<T>): { data: T | undefined; error: unknown; key: string } {
  const { user } = useUser();
  const k = `ads:dash:${user?.id ?? "-"}:${key}`;
  fetchers.set(k, fetcher);
  const q = useQuery<T>(k, fetcher, { enabled: !!user, revalidateOnFocus: false, dedupeMs: DASH_FRESH_MS });
  return { data: q.data, error: q.error, key: k };
}

/** Re-read every dashboard section now — after the advertiser changed something. */
export function refreshAdDashboard(): void {
  for (const [k, f] of fetchers) void revalidate(k, f, 0).catch(() => {});
}

/** An optimistic change to one cached section (e.g. a removed row leaves at once). */
export function patchDash<T>(fullKey: string, update: (prev: T | undefined) => T): void {
  mutate<T>(fullKey, update);
}
