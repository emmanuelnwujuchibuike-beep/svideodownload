import "server-only";

import { getCharacterReplaceBalanceCents, listCharacterReplaceLedger, type CharacterReplaceLedgerEntry } from "@/lib/ai/character-replace/wallet";
import { calculateCredits } from "@/lib/ai/credits/engine";
import { getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { featureContext } from "@/lib/ai/credits/feature-gate";
import { AI_CREDIT_FEATURES, AI_FEATURE_LABELS, type AiCreditFeatureId } from "@/lib/ai/credits/features";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { publicWalletOffer } from "@/lib/ai/credits/wallet-config";
import { klingPipeline } from "@/lib/ai/kling/pipelines/registry";
import { lipSyncCredits, quoteLipSync } from "@/lib/ai/lip-sync/pricing";
import { textToAudioAllowance } from "@/lib/ai/text-to-audio/config";
import { readFreeCharacters } from "@/lib/ai/text-to-audio/free";
import { quoteTextToAudio, textToAudioCredits, textToAudioMonthKey } from "@/lib/ai/text-to-audio/pricing";
import { quoteVoiceClone, voiceCloneCredits } from "@/lib/ai/voice-clone/pricing";
import type { LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WALLET SUMMARY — everything the AI wallet page shows, in one read
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Credit brief §15: "a secure endpoint that returns wallet balance · plan ·
 * free AI allowance · feature availability · recent transactions · pending
 * transactions." Part 2 (§46): a first-time member must be able to answer
 * "how many credits, which plan, how do I get more, what does each tool cost,
 * how many characters are left, where is my history" at a glance.
 *
 * It REUSES the reads that already exist — the wallet, the ledger, the plan
 * entitlement, the feature table, the Text to Audio counter — and adds no
 * store. Display only: every decision that spends is made again at /start.
 * Nothing internal leaves: no provider, no model, no USD cost, no admin id.
 */

/** Ledger kinds, in the brief's words (§2). Reversal and adjustment are both operator corrections. */
const TYPE: Record<string, string> = {
  recharge: "credit_purchase",
  bonus: "credit_bonus",
  grant: "credit_grant",
  refund: "credit_refund",
  processing_charge: "credit_usage",
  adjustment: "credit_adjustment",
  reversal: "credit_adjustment",
};

/** A tool's cheapest common job, priced by the tool's own engine and the one credit engine — the "from" on a feature card. */
function fromCredits(id: AiCreditFeatureId, settings: LandingSettings): { credits: number; per: string } | null {
  const plans = settings.frenzAiPlans;
  const money = { currency: settings.frenzAiCurrency };
  try {
    if (id === "ai_text_to_video" || id === "ai_image_to_video") {
      const pipeline = klingPipeline(id === "ai_text_to_video" ? "text_to_video" : "image_to_video");
      const q = pipeline.quote({ prompt: "x", options: { durationSeconds: 3, resolution: "720p" } } as never, settings.frenzAiKlingPricing);
      if (!q.ok) return null;
      return { credits: calculateCredits({ feature: id, priceCents: q.totalUsdCents, mode: "video", quality: q.resolution, durationMs: q.billableSeconds * 1000 }, plans).creditsRequired, per: "3 s video at 720p" };
    }
    if (id === "ai_lip_sync") {
      const q = quoteLipSync({ durationMs: 5000, speechSource: "audio", speechPath: "audio", textCharacters: 0 }, settings.frenzAiLipSync, money);
      return { credits: lipSyncCredits(q, settings.frenzAiLipSync, plans).creditsRequired, per: "5 s clip" };
    }
    if (id === "ai_voice_clone") {
      const q = quoteVoiceClone({ freeClonesAvailable: 0 }, settings.frenzAiVoiceClone, money);
      return { credits: q.totalCents > 0 ? voiceCloneCredits(q, settings.frenzAiVoiceClone, plans).creditsRequired : 0, per: "voice" };
    }
    if (id === "ai_text_to_audio") {
      const q = quoteTextToAudio({ characters: 100, freeCharactersAvailable: 0 }, settings.frenzAiTextToAudio, money);
      return { credits: q.totalCents > 0 ? textToAudioCredits(q, settings.frenzAiTextToAudio, plans).creditsRequired : 0, per: "100 characters beyond your allowance" };
    }
  } catch {
    // a tool that cannot price right now shows no figure — never a guessed one
  }
  return null;
}

export async function loadWalletSummary(userId: string, settings: LandingSettings, opts: { transactions: number }) {
  const plans = settings.frenzAiPlans;
  const db = createAdminClient();
  const [balance, ledger, entitlement, contexts] = await Promise.all([
    getCharacterReplaceBalanceCents(userId),
    listCharacterReplaceLedger(userId, Math.max(1, Math.min(50, opts.transactions))),
    getAiCreditEntitlement(userId, plans),
    Promise.all(AI_CREDIT_FEATURES.map((id) => featureContext(userId, id, plans))),
  ]);
  const tier = contexts[0]?.tier ?? "free";

  // which tool each charge paid for — one bounded lookup by the jobs on this page of the statement
  const jobIds = [...new Set(ledger.map((r) => r.jobId).filter((x): x is string => !!x))];
  const featureOf = new Map<string, string>();
  if (jobIds.length) {
    const { data } = await db.from("ai_jobs").select("id, feature").in("id", jobIds);
    for (const j of (data ?? []) as { id: string; feature: string }[]) featureOf.set(j.id, j.feature);
  }
  // pending: credits held by creations still running (reserved, not yet settled or refunded)
  const { data: pendingRows } = await db.from("ai_product_ledger").select("delta_cents").eq("user_id", userId).eq("kind", "processing_charge").eq("status", "reserved").eq("currency", WALLET_UNIT).limit(50);
  const pending = (pendingRows ?? []) as { delta_cents: number }[];

  const tta = settings.frenzAiTextToAudio;
  const ttaMonth = textToAudioMonthKey(new Date(), plans.reset.timezone);
  const ttaFree = await readFreeCharacters(userId, ttaMonth, textToAudioAllowance(tta, tier));

  const planConfig = entitlement.plan ? plans.plans[entitlement.plan] : null;
  return {
    unit: WALLET_UNIT,
    balanceCredits: balance,
    plan: {
      tier,
      label: tier === "free" ? "Free" : (planConfig?.label ?? (tier === "ai_max" ? "AI Max" : "AI Pro")),
      offerEnabled: plans.enabled,
      subscription: entitlement.subscription
        ? { status: entitlement.subscription.status, active: entitlement.subscription.active, currentPeriodEnd: entitlement.subscription.currentPeriodEnd, cancelAtPeriodEnd: entitlement.subscription.cancelAtPeriodEnd }
        : null,
      allowance: entitlement.plan
        ? { dailyLimit: entitlement.dailyLimit, weeklyLimit: entitlement.weeklyLimit, remainingToday: entitlement.remainingToday, remainingThisWeek: entitlement.remainingThisWeek, dayResetsAt: entitlement.dayResetsAt, weekResetsAt: entitlement.weekResetsAt }
        : null,
    },
    features: AI_CREDIT_FEATURES.map((id, i) => {
      const ctx = contexts[i]!;
      return { id, label: AI_FEATURE_LABELS[id], ...ctx.view, from: ctx.view.available ? fromCredits(id, settings) : null };
    }),
    textToAudio: { tier, allowance: ttaFree.allowance, used: ttaFree.used, remaining: ttaFree.remaining, monthKey: ttaFree.monthKey, partialAllowance: tta.partialAllowance },
    pending: { count: pending.length, credits: pending.reduce((a, r) => a + Math.max(0, -Number(r.delta_cents)), 0) },
    transactions: ledger.map((r: CharacterReplaceLedgerEntry) => ({
      id: r.id,
      type: TYPE[r.kind] ?? "credit_adjustment",
      kind: r.kind,
      status: r.status,
      amount: r.deltaCents,
      unit: r.currency,
      balanceAfter: r.balanceAfterCents,
      balanceBefore: r.balanceAfterCents - r.deltaCents,
      feature: r.jobId ? (featureOf.get(r.jobId) ?? null) : null,
      jobId: r.jobId,
      reference: r.reference,
      note: r.kind === "adjustment" || r.kind === "grant" || r.kind === "bonus" ? r.note : null,
      at: r.createdAt,
    })),
    offer: publicWalletOffer(plans.wallet, plans.credits.centsPerCredit),
  };
}
export type WalletSummary = Awaited<ReturnType<typeof loadWalletSummary>>;
