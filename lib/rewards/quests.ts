/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUESTS — daily and weekly goals that earn credits (0192, pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "a weekly quest that resets every Sunday 1am Lagos time …
 * a daily quest that resets at 1am … admin can set a quest and a reward …
 * not all events have the same rewards … it has a weekly limit."
 *
 * The operator's list lives in `frenzRewards.quests` (the reward rules row the
 * SQL engine reads). Each quest names an event the engine already sees, a
 * target count, a reward and a period. Counting, completion and the reward all
 * happen in SQL (`quest_record`) — once per source, once per quest per period,
 * under the weekly cap — so nothing here moves credits.
 *
 * 🔴 Shipped OFF (`enabled: false`): quests pay real credits, and nothing may
 * cost money until the operator has looked at the list and switched it on.
 */
/*
  🔴 2026-10-23 (owner: "make admin can add any quest, like posting Wallpapers to earn credit … it should be
  fully configurable"). The list grew from the seven events the reward engine raised to every activity the
  database now reports to quests (migration 0269's triggers). Each one here has a real source — a quest on
  an activity nothing reports would never pay, which is why there is no free-text activity.
*/
export const QUEST_EVENTS = [
  "download_completed",
  "ai_video_completed",
  "ai_audio_completed",
  "ai_video_shared",
  "post_engagement",
  "follow",
  "save",
  "wallpaper_posted",
  "post_published",
  "reel_posted",
  "story_posted",
  "comment_posted",
  "friend_added",
  "message_sent",
  "exclusive_post_published",
  "app_rated",
] as const;
export type QuestEvent = (typeof QUEST_EVENTS)[number];

export const QUEST_EVENT_LABELS: Record<QuestEvent, string> = {
  download_completed: "Downloads",
  ai_video_completed: "AI videos generated",
  ai_audio_completed: "AI audio generated",
  ai_video_shared: "AI videos shared to AI Reels",
  post_engagement: "Likes or comments on posts",
  follow: "New follows",
  save: "Posts saved",
  wallpaper_posted: "Wallpapers posted",
  post_published: "Posts published",
  reel_posted: "Reels posted",
  story_posted: "Stories posted",
  comment_posted: "Comments written",
  friend_added: "Friends added",
  message_sent: "Chat messages sent",
  exclusive_post_published: "Exclusive posts published",
  app_rated: "Rated the app",
};

/** 0269: "once" — a one-time quest, completed once per member, ever (its period key never resets). */
export type QuestPeriod = "daily" | "weekly" | "once";
export const QUEST_PERIOD_LABELS: Record<QuestPeriod, string> = { daily: "Daily", weekly: "Weekly", once: "One-time" };

export interface Quest {
  id: string;
  title: string;
  event: QuestEvent;
  target: number;
  credits: number;
  period: QuestPeriod;
  enabled: boolean;
}

export interface QuestsConfig {
  enabled: boolean;
  /** The most quest credits one member can earn in a week (Sunday 01:00 → Sunday 01:00, Lagos). 0 = no cap. */
  weeklyCreditCap: number;
  items: Quest[];
}

export const QUEST_LIMITS = { items: 20, title: 60, target: 1000, credits: 10_000, weeklyCap: 1_000_000 } as const;

export const QUESTS_DEFAULTS: QuestsConfig = {
  enabled: false,
  weeklyCreditCap: 50,
  items: [
    { id: "daily-downloads", title: "Save 3 videos", event: "download_completed", target: 3, credits: 1, period: "daily", enabled: true },
    { id: "daily-engage", title: "Like or comment on 5 posts", event: "post_engagement", target: 5, credits: 1, period: "daily", enabled: true },
    { id: "weekly-ai-video", title: "Create 2 AI videos", event: "ai_video_completed", target: 2, credits: 5, period: "weekly", enabled: true },
    { id: "weekly-ai-reel", title: "Share an AI video to AI Reels", event: "ai_video_shared", target: 1, credits: 3, period: "weekly", enabled: true },
    { id: "weekly-downloads", title: "Save 20 videos", event: "download_completed", target: 20, credits: 3, period: "weekly", enabled: true },
  ],
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function int(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
}

/** An id the SQL dedupe key can carry: lowercase letters, digits and dashes. */
export function questId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function normalizeQuests(raw: unknown): QuestsConfig {
  const d = QUESTS_DEFAULTS;
  if (!isRecord(raw)) return { ...d, items: d.items.map((q) => ({ ...q })) };
  const seen = new Set<string>();
  const items: Quest[] = [];
  for (const q of Array.isArray(raw.items) ? raw.items : []) {
    if (!isRecord(q)) continue;
    const event = QUEST_EVENTS.find((e) => e === q.event);
    const title = typeof q.title === "string" ? q.title.replace(/\s+/g, " ").trim().slice(0, QUEST_LIMITS.title) : "";
    const id = questId(typeof q.id === "string" && q.id ? q.id : title);
    if (!event || !title || !id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title,
      event,
      target: int(q.target, 1, 1, QUEST_LIMITS.target),
      credits: int(q.credits, 0, 0, QUEST_LIMITS.credits),
      period: q.period === "weekly" ? "weekly" : q.period === "once" ? "once" : "daily",
      enabled: q.enabled !== false,
    });
    if (items.length >= QUEST_LIMITS.items) break;
  }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    weeklyCreditCap: int(raw.weeklyCreditCap, d.weeklyCreditCap, 0, QUEST_LIMITS.weeklyCap),
    items: Array.isArray(raw.items) ? items : d.items.map((q) => ({ ...q })),
  };
}

/** What a member's quest page shows for one quest — the server's numbers. */
export interface QuestView {
  id: string;
  title: string;
  event: QuestEvent;
  period: QuestPeriod;
  target: number;
  credits: number;
  progress: number;
  completed: boolean;
}

export interface QuestBoard {
  enabled: boolean;
  daily: QuestView[];
  weekly: QuestView[];
  /** 0269: one-time quests — done once, ever. */
  once: QuestView[];
  weeklyCreditCap: number;
  weekEarned: number;
  dayEndsAt: string;
  weekEndsAt: string;
}

/** The board from the config and `quest_status()` — pure, so it is tested without a database. */
export function buildQuestBoard(
  cfg: QuestsConfig,
  status: { periods: { day: string; week: string; dayEndsAt: string; weekEndsAt: string }; progress: { quest: string; period: string; progress: number; completedAt: string | null }[]; weekEarned: number },
): QuestBoard {
  const view = (q: Quest): QuestView => {
    const key = q.period === "weekly" ? status.periods.week : q.period === "once" ? "ONCE" : status.periods.day;
    const row = status.progress.find((p) => p.quest === q.id && p.period === key);
    const progress = Math.min(q.target, row?.progress ?? 0);
    return { id: q.id, title: q.title, event: q.event, period: q.period, target: q.target, credits: q.credits, progress, completed: !!row?.completedAt || progress >= q.target };
  };
  const live = cfg.items.filter((q) => q.enabled);
  return {
    enabled: cfg.enabled,
    daily: live.filter((q) => q.period === "daily").map(view),
    weekly: live.filter((q) => q.period === "weekly").map(view),
    once: live.filter((q) => q.period === "once").map(view),
    weeklyCreditCap: cfg.weeklyCreditCap,
    weekEarned: Number(status.weekEarned) || 0,
    dayEndsAt: status.periods.dayEndsAt,
    weekEndsAt: status.periods.weekEndsAt,
  };
}
