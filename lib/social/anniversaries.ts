import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { pushPerson } from "@/lib/push/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { profilePath } from "@/lib/social/profile-url";

/**
 * FRIENDSHIP ANNIVERSARIES (Feature 20 Part 8, Relationship Celebrations) — "You and Ada became
 * friends 1 year ago today 🎉", to BOTH friends, on the day. Derived from friendships.created_at
 * (the same timestamp the Relationship Timeline already shows), never stored twice.
 *
 * Runs inside the existing daily job (/api/cron/profile-snapshots) — no new schedule, nothing on
 * a timer. Low priority, social category: it obeys every switch, quiet hours, Do Not Disturb and
 * the member's delivery rules like any other social notification. Bounded per run; a re-run the
 * same day sends nothing twice. 29 February friendships are celebrated on 28 February.
 */
export const MAX_YEARS = 10;
const MAX_SENDS = 500;

/** The UTC day `years` before `now`, as [start, end). */
export function anniversaryWindow(now: Date, years: number): { from: string; to: string } {
  const y = now.getUTCFullYear() - years;
  const m = now.getUTCMonth();
  // a 29 Feb friendship falls on 28 Feb in a common year: include the 29th on the 28th
  const isFeb28 = m === 1 && now.getUTCDate() === 28 && new Date(Date.UTC(now.getUTCFullYear(), 1, 29)).getUTCMonth() !== 1;
  const start = Date.UTC(y, m, now.getUTCDate());
  const end = start + (isFeb28 ? 2 : 1) * 86_400_000;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

export function anniversaryLine(years: number): string {
  return years === 1 ? "You became friends 1 year ago today 🎉" : `You became friends ${years} years ago today 🎉`;
}

export async function sendFriendAnniversaries(now = new Date()): Promise<{ sent: number }> {
  const db = createAdminClient();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let sent = 0;
  for (let years = 1; years <= MAX_YEARS && sent < MAX_SENDS; years++) {
    const w = anniversaryWindow(now, years);
    const { data } = await db.from("friendships").select("user_low, user_high").gte("created_at", w.from).lt("created_at", w.to).limit(MAX_SENDS);
    for (const f of (data ?? []) as { user_low: string; user_high: string }[]) {
      for (const [me, them] of [[f.user_low, f.user_high], [f.user_high, f.user_low]] as const) {
        if (sent >= MAX_SENDS) break;
        // never twice in a day (a re-run, or the job retried)
        const { data: already } = await db.from("notifications").select("id").eq("user_id", me).eq("type", "milestone").eq("actor_id", them).gte("created_at", todayStart).limit(1);
        if (already?.length) continue;
        const who = await pushPerson(them);
        await sendSmartPush(
          me,
          { title: who.name, body: anniversaryLine(years), url: who.handle ? `${profilePath(who.handle)}` : "/friends", icon: who.icon, tag: `anniversary:${them}`, actorId: them },
          "low",
          "social",
          { type: "milestone", actorId: them },
        ).catch(() => {});
        sent++;
      }
    }
  }
  return { sent };
}
