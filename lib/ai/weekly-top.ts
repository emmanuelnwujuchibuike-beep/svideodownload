import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendPushToUser } from "@/lib/push/web-push";

import { rankSpenders, spendByUser, weekBounds, weeklyAwards, weekStartOf } from "./weekly-top-rules";

/**
 * Weekly top AI creators — the spend, the prizes and the admin overview
 * (owner, 2026-10-10). Rules: ./weekly-top-rules.ts.
 *
 * Spend is read from the credit ledger (ai_product_ledger, CREDIT unit):
 * settled processing charges minus refunds inside the week. Prizes go through
 * grant_reward (the rewards engine — same wallet, same once-only key) and are
 * recorded in ai_weekly_awards (0218), whose (week, rank) key makes a week
 * payable once however often the job runs.
 */
type Db = SupabaseClient;
const DAY = 86_400_000;
const PAGE = 1000;
const MAX_ROWS = 50_000;

async function ledgerSpend(db: Db, weekStart: string): Promise<Map<string, number>> {
  const { start, end } = weekBounds(weekStart);
  const rows: { user_id: string; delta_cents: number }[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db
      .from("ai_product_ledger")
      .select("user_id, delta_cents")
      .in("kind", ["processing_charge", "refund"])
      .eq("currency", "CREDIT")
      .eq("status", "settled")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`weekly spend: ${error.message}`);
    const page = (data ?? []) as { user_id: string; delta_cents: number }[];
    rows.push(...page.map((r) => ({ user_id: r.user_id, delta_cents: Number(r.delta_cents) })));
    if (page.length < PAGE) break;
  }
  return spendByUser(rows);
}

/**
 * Pay the week that just closed. Looks only during the day after a week ends
 * (the 10-minute job then finds it at once), and only if that week has no
 * award rows yet. Before 0218 runs, the award table is missing: nothing is paid.
 */
export async function awardClosedWeek(db: Db, now: number = Date.now()): Promise<{ week: string; awarded: number } | { skipped: string }> {
  const thisWeek = weekStartOf(now);
  const lastWeek = weekStartOf(Date.parse(`${thisWeek}T00:00:00Z`) - DAY);
  if (now - Date.parse(`${thisWeek}T00:00:00Z`) > DAY) return { skipped: "outside the award window" };
  const { data: done, error } = await db.from("ai_weekly_awards").select("rank").eq("week_start", lastWeek).limit(1);
  if (error) return { skipped: "awards table missing" };
  if (done?.length) return { skipped: "already awarded" };

  const winners = weeklyAwards(rankSpenders(await ledgerSpend(db, lastWeek), 3));
  let awarded = 0;
  for (const w of winners) {
    const { error: gErr } = await db.rpc("grant_reward", {
      p_beneficiary: w.userId,
      p_role: "actor",
      p_event: "weekly_top_creator",
      p_source_type: "ai_week",
      p_source_id: lastWeek,
      p_actor: null,
      p_referred: null,
      p_amount: w.credits,
      p_dedupe: `${lastWeek}:${w.rank}`,
      p_cfg: {},
      p_metadata: { rank: w.rank, spent: w.spent },
    });
    if (gErr) {
      console.error("[ai/weekly-top] grant failed", { week: lastWeek, rank: w.rank, message: gErr.message });
      continue;
    }
    const { error: aErr } = await db.from("ai_weekly_awards").insert({ week_start: lastWeek, rank: w.rank, user_id: w.userId, spent: w.spent, credits: w.credits });
    if (aErr && aErr.code !== "23505") continue;
    if (!aErr) {
      awarded += 1;
      void sendPushToUser(w.userId, {
        title: `You were #${w.rank} on Frenz AI this week`,
        body: `${w.credits} free credits are in your wallet. Thank you for creating.`,
        url: "/ai/usage",
        tag: `weekly-top:${lastWeek}`,
      }).catch(() => {});
    }
  }
  return { week: lastWeek, awarded };
}

/* ───────────────────────────── the admin overview ───────────────────────────── */

const VIDEO = new Set(["text_to_video", "ai_text_to_video", "image_to_video", "ai_character_replace", "ai_lip_sync", "lip_sync", "ai_clean"]);
const AUDIO = new Set(["ai_text_to_audio", "ai_voice_clone"]);
export function creationKind(feature: string): "video" | "audio" | "other" {
  return VIDEO.has(feature) ? "video" : AUDIO.has(feature) ? "audio" : "other";
}

export interface AiCreationsOverview {
  windows: { label: string; video: number; audio: number; other: number }[];
  topCreators: { userId: string; handle: string | null; displayName: string | null; avatarUrl: string | null; spent: number; creations: number; video: number; audio: number; lastAt: string | null }[];
  recent: { id: string; feature: string; kind: "video" | "audio" | "other"; createdAt: string; handle: string | null }[];
  lastWeek: { week: string; winners: { rank: number; handle: string | null; displayName: string | null; spent: number; credits: number }[] } | null;
  weekStart: string;
}

export async function aiCreationsOverview(db: Db, now: number = Date.now()): Promise<AiCreationsOverview> {
  const weekStart = weekStartOf(now);
  const since30 = new Date(now - 30 * DAY).toISOString();
  const { data: jobs } = await db
    .from("ai_jobs")
    .select("id, user_id, feature, created_at")
    .eq("status", "completed")
    .gte("created_at", since30)
    .order("created_at", { ascending: false })
    .limit(5000);
  const list = (jobs ?? []) as { id: string; user_id: string; feature: string; created_at: string }[];
  const count = (sinceMs: number) => {
    const c = { video: 0, audio: 0, other: 0 };
    for (const j of list) if (Date.parse(j.created_at) >= sinceMs) c[creationKind(j.feature)] += 1;
    return c;
  };
  const startOfToday = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const windows = [
    { label: "Today", ...count(startOfToday) },
    { label: "7 days", ...count(now - 7 * DAY) },
    { label: "30 days", ...count(now - 30 * DAY) },
  ];

  const ranked = rankSpenders(await ledgerSpend(db, weekStart).catch(() => new Map<string, number>()), 10);
  const weekStartMs = Date.parse(`${weekStart}T00:00:00Z`);
  const { data: lastAwards } = await db.from("ai_weekly_awards").select("week_start, rank, user_id, spent, credits").order("week_start", { ascending: false }).order("rank", { ascending: true }).limit(3);
  const awards = (lastAwards ?? []) as { week_start: string; rank: number; user_id: string; spent: number; credits: number }[];
  const ids = [...new Set([...ranked.map((r) => r.userId), ...awards.map((a) => a.user_id), ...list.slice(0, 10).map((j) => j.user_id)])];
  const { data: profs } = ids.length ? await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids) : { data: [] };
  const prof = new Map(((profs ?? []) as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));

  const topCreators = ranked.map((r) => {
    const mine = list.filter((j) => j.user_id === r.userId && Date.parse(j.created_at) >= weekStartMs);
    return {
      userId: r.userId,
      handle: prof.get(r.userId)?.handle ?? null,
      displayName: prof.get(r.userId)?.display_name ?? null,
      avatarUrl: prof.get(r.userId)?.avatar_url ?? null,
      spent: r.spent,
      creations: mine.length,
      video: mine.filter((j) => creationKind(j.feature) === "video").length,
      audio: mine.filter((j) => creationKind(j.feature) === "audio").length,
      lastAt: mine[0]?.created_at ?? null,
    };
  });
  const lastWeekKey = awards[0]?.week_start ?? null;
  return {
    weekStart,
    windows,
    topCreators,
    recent: list.slice(0, 10).map((j) => ({ id: j.id, feature: j.feature, kind: creationKind(j.feature), createdAt: j.created_at, handle: prof.get(j.user_id)?.handle ?? null })),
    lastWeek: lastWeekKey
      ? {
          week: lastWeekKey,
          winners: awards.filter((a) => a.week_start === lastWeekKey).map((a) => ({ rank: a.rank, handle: prof.get(a.user_id)?.handle ?? null, displayName: prof.get(a.user_id)?.display_name ?? null, spent: a.spent, credits: a.credits })),
        }
      : null,
  };
}
