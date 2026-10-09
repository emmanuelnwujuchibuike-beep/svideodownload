/**
 * Chat streaks (0200, owner 2026-10-09) — the pure rules, shared by the inbox read
 * (lib/social/messages.ts) and the inbox UI (features/social/chat-streak.tsx).
 */

/** Shown from this many days. */
export const CHAT_STREAK_MIN_DAYS = 2;

/** A stored chat streak as it stands NOW: its days while the last counted day is today or yesterday (UTC), else 0. */
export function liveStreakDays(row: { current_days: number; last_day: string | null } | undefined, now = new Date()): number {
  if (!row?.last_day || !(row.current_days > 0)) return 0;
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return row.last_day === today || row.last_day === yesterday ? row.current_days : 0;
}

/** Which chat's streak grew since this browser last looked — the biggest one, or null. */
export function grownStreak(conversations: { id: string; streakDays: number }[], seen: Record<string, number>): { id: string; days: number } | null {
  let best: { id: string; days: number } | null = null;
  for (const c of conversations) {
    const days = c.streakDays ?? 0;
    if (days >= CHAT_STREAK_MIN_DAYS && days > (seen[c.id] ?? 0) && (!best || days > best.days)) best = { id: c.id, days };
  }
  return best;
}
