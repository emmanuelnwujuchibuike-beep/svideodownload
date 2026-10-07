import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import type { RewardEventType } from "@/lib/rewards/config";
import { REWARD_EVENT_LABELS } from "@/lib/rewards/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE REWARD ENGINE, from the server's side
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There is ONE engine and it lives in the database: `process_reward_event`
 * (migration 0187). It reads the operator's rules, checks the facts the event
 * depends on (a job really completed, a video really is ≥ 30 s and published
 * by its owner), rewards the actor and the actor's referrer, decides each
 * reward's class from the beneficiary's qualification at that instant, credits
 * the one wallet and writes the in-app notification — in one transaction, and
 * at most once per (beneficiary, role, event, source) by a unique index.
 *
 * Database triggers call it for what the database sees happen. This module is
 * how the SERVER calls it for the rest (an AI reel published, a referred
 * signup). Then — after the commit — it sends the push. A push that fails is
 * logged and forgotten: it can never take back a reward that was granted.
 *
 * The browser never calls this. Nothing a browser sends is an amount, a class,
 * a duration, an owner or a completion.
 */
export interface GrantedReward {
  reward_id: string;
  beneficiary_id: string;
  role: "actor" | "referrer";
  event: string;
  amount: number;
  credit_class: "usable" | "withdrawable";
  balance_after: number;
}

export async function processRewardEvent(input: { eventType: RewardEventType; actorUserId: string; sourceType: string; sourceId: string; metadata?: Record<string, unknown> }): Promise<GrantedReward[]> {
  const { data, error } = await createAdminClient().rpc("process_reward_event", {
    p_event: input.eventType,
    p_actor: input.actorUserId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_metadata: input.metadata ?? {},
  });
  if (error) {
    console.error("[rewards] engine failed", { event: input.eventType, actor: input.actorUserId, source: `${input.sourceType}:${input.sourceId}`, message: error.message });
    return [];
  }
  const granted = (Array.isArray(data) ? data : []) as GrantedReward[];
  for (const g of granted) console.info("[rewards] granted", { event: g.event, role: g.role, beneficiary: g.beneficiary_id, amount: g.amount, class: g.credit_class, reward: g.reward_id });
  if (granted.length) void pushRewards(granted);
  return granted;
}

/** The push for rewards already committed (and already recorded in-app by the engine). Never throws. */
export async function pushRewards(granted: GrantedReward[]): Promise<void> {
  await Promise.all(
    granted.map(async (g) => {
      const label = REWARD_EVENT_LABELS[g.event as RewardEventType] ?? g.event.replace(/_/g, " ");
      const credits = `${g.amount} credit${g.amount === 1 ? "" : "s"}`;
      const body =
        g.event === "ai_video_completed" && g.role === "actor"
          ? `Your AI video earned you ${credits}.`
          : g.event === "ai_video_shared" && g.role === "actor"
            ? `Your AI Reel share earned you ${credits}.`
            : g.role === "referrer"
              ? `Someone you invited — ${label.toLowerCase()} — earned you ${credits}.`
              : `${label} earned you ${credits}.`;
      try {
        await sendSmartPush(g.beneficiary_id, { title: `+${credits}`, body, url: "/studio/ai/usage", genericBody: "You earned credits.", tag: `reward-${g.reward_id}` }, "medium", "premium", "already-recorded");
      } catch (e) {
        console.warn("[rewards] push failed (the reward stands)", { reward: g.reward_id, error: String(e).slice(0, 200) });
      }
    }),
  );
}

/**
 * The rewards the DATABASE granted on its own for a job (the completion
 * trigger) — read back so the job's "ready" push can carry the line. Display
 * only; nothing is granted here.
 */
export async function rewardsForSource(sourceType: string, sourceId: string): Promise<GrantedReward[]> {
  const { data } = await createAdminClient()
    .from("reward_events")
    .select("id, beneficiary_id, role, event_type, amount, credit_class")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .limit(5);
  return ((data ?? []) as { id: string; beneficiary_id: string; role: "actor" | "referrer"; event_type: string; amount: number; credit_class: "usable" | "withdrawable" }[]).map((r) => ({ reward_id: r.id, beneficiary_id: r.beneficiary_id, role: r.role, event: r.event_type, amount: r.amount, credit_class: r.credit_class, balance_after: 0 }));
}
