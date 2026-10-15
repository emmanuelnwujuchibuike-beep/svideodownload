import { REWARD_EVENT_LABELS, REWARD_EVENTS, type RewardsConfig, type RewardEventType } from "@/lib/rewards/config";

/**
 * What the anonymous Profile page may say about earning (owner brief 2026-10-11:
 * "display only activities currently supported … do not promise credits for
 * activities that do not actually grant them").
 *
 * Every line is derived from the LIVE reward rules (Admin → Rewards): a switched-off
 * event is never mentioned, every number is the configured one, and nothing is
 * promised as cash — only Credits earned after qualifying can be withdrawn, and only
 * while withdrawals are open. Pure, so a test can hold it to that.
 */

export interface EarnItem {
  id: string;
  title: string;
  body: string;
  href: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Specific copy for the events members actually meet; any other switched-on event gets its admin label. */
const ACTOR_COPY: Partial<Record<RewardEventType, (n: number, cfg: RewardsConfig) => { title: string; body: string; href: string }>> = {
  ai_video_completed: (n, cfg) => ({
    title: "Create with Frenz AI",
    body: `Earn ${plural(n, "credit")} for each AI video you create${cfg.events.ai_video_completed.includeComplimentary ? "" : " (free trial videos don't count)"}.`,
    href: "/ai",
  }),
  ai_video_shared: (n, cfg) => ({
    title: "Share to Reels",
    body: `Earn ${plural(n, "credit")} when you share an AI video${cfg.events.ai_video_shared.minDurationSeconds ? ` of ${cfg.events.ai_video_shared.minDurationSeconds} seconds or longer` : ""} to Reels.`,
    href: "/reels",
  }),
  download_completed: (n) => ({ title: "Eligible downloads", body: `Earn ${plural(n, "credit")} for eligible completed downloads.`, href: "/" }),
  account_created: (n) => ({ title: "Join Frenzsave", body: `Earn ${plural(n, "credit")} when you create your account.`, href: "/login" }),
  ai_audio_completed: (n) => ({ title: "Create AI audio", body: `Earn ${plural(n, "credit")} for each AI audio you create.`, href: "/ai/text-to-audio" }),
  ai_image_completed: (n) => ({ title: "Create AI images", body: `Earn ${plural(n, "credit")} for each AI image you create.`, href: "/ai" }),
  ai_avatar_completed: (n) => ({ title: "Create AI avatars", body: `Earn ${plural(n, "credit")} for each AI avatar you create.`, href: "/ai" }),
};

/** "a, b and c" */
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function earnOpportunities(cfg: RewardsConfig): EarnItem[] {
  if (!cfg.enabled) return [];
  const out: EarnItem[] = [];
  const referrer: string[] = [];
  for (const e of REWARD_EVENTS) {
    const r = cfg.events[e];
    if (!r?.enabled) continue;
    if (r.actorCredits > 0) {
      const copy = ACTOR_COPY[e]?.(r.actorCredits, cfg) ?? { title: REWARD_EVENT_LABELS[e], body: `Earn ${plural(r.actorCredits, "credit")} for this activity.`, href: "/rewards" };
      out.push({ id: e, ...copy });
    }
    if (r.referrerCredits > 0) referrer.push(`${plural(r.referrerCredits, "credit")} when they ${REFERRER_VERB[e] ?? REWARD_EVENT_LABELS[e].toLowerCase()}`);
  }
  if (referrer.length) out.unshift({ id: "referrals", title: "Invite friends", body: `Share your link with people you know. Earn ${list(referrer)}.`, href: "/rewards" });
  if (cfg.quests.enabled && cfg.quests.items.some((q) => q.enabled !== false)) {
    out.push({ id: "quests", title: "Daily and weekly quests", body: cfg.quests.weeklyCreditCap > 0 ? `Complete quests for credits, up to ${plural(cfg.quests.weeklyCreditCap, "credit")} a week.` : "Complete quests to earn credits.", href: "/quests" });
  }
  return out;
}

const REFERRER_VERB: Partial<Record<RewardEventType, string>> = {
  account_created: "join",
  ai_video_completed: "create an AI video",
  ai_video_shared: "share an AI video to Reels",
  download_completed: "complete a download",
  subscription_started: "start an AI plan",
  wallet_topup: "top up credits",
};

/** How credits become money — only what the live rules allow. */
export function cashOutLine(cfg: RewardsConfig): string {
  if (!cfg.enabled || !cfg.withdrawals.enabled) return "Credits are for Frenz AI tools. Cash-outs aren't open right now.";
  const q = cfg.qualification;
  const needs = [q.minAccountAgeDays > 0 ? `${plural(q.minAccountAgeDays, "active day")}` : null, q.minEngagements > 0 ? `${plural(q.minEngagements, "qualifying engagement")}` : null].filter(Boolean);
  return `Rewards earned after your account is approved for withdrawals can be cashed out${needs.length ? `. To apply you need ${needs.join(" and ")}` : ""}; the team then reviews it. Everything else stays usable on Frenz AI tools and is never cashable.`;
}
