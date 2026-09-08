import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import type { AiFeature } from "@/lib/ai/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — rewarded-ad authorization, and an honest account of its limits
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 READ THIS BEFORE TRUSTING A REWARD ────────────────────────────────────
 *
 * The brief (Part 5 §27) asks that the selected ad network be checked for
 * genuine server-side reward verification BEFORE building on it, and says
 * plainly: "Do not fake server verification if the provider does not offer a
 * suitable mechanism."
 *
 * It was checked. **No ad network wired into this site can prove a reward.**
 * Google's own documentation confirms server-side verification for rewarded ads
 * is an app-only feature; the web SDK reports completion to the PAGE, and a page
 * can say anything. `lib/monetization/reward-sessions.ts` reached the same
 * conclusion for downloads in August and wrote it down rather than pretending
 * otherwise.
 *
 * So `attestedRewardProvider` below is marked `verifiable: false`, in the type,
 * where nobody can miss it. What this module provides is NOT proof that an ad
 * was watched. It is a bound, single-use authorization: a claim can only ever
 * unlock ONE job, for the ONE member who earned it, for the ONE feature it was
 * created for, inside a short window, and only while that member still has
 * daily allowance left. A forged claim buys a slot the member already owned —
 * it can never buy a fourth clean, spend somebody else's allowance, or run
 * twice.
 *
 * That is the whole security value, and it is worth having. It is also not the
 * same as verification, and this file will keep saying so until a provider that
 * can actually verify is wired in — at which point `verify()` gets a real
 * implementation and NOTHING ELSE in the authorization flow changes.
 *
 * ── The seam ─────────────────────────────────────────────────────────────────
 *
 * `AiRewardProvider` is the whole coupling. The authorization layer asks two
 * questions — "is this claim good?" and "what is the provider's id for it?" —
 * and knows nothing else about any network.
 */

/** How long a member has to finish the ad before the session dies. */
export const AI_REWARD_TTL_SECONDS = 10 * 60;

export interface RewardVerification {
  verified: boolean;
  /**
   * The network's own id for this reward, when it has one.
   *
   * Uniquely indexed in the database, so a provider that supplies one gets
   * duplicate-callback protection at no cost. Null for every provider wired
   * today, which is exactly why the session id carries the single-use rule
   * instead.
   */
  providerRewardId: string | null;
  /** Operator-facing only. Never returned to a browser. */
  detail?: string;
}

export interface AiRewardProvider {
  id: string;
  /**
   * 🔴 Whether this provider can PROVE the reward happened.
   *
   * False for everything available today. It is a field rather than a comment
   * so that a future audit can read the truth out of the code, and so an
   * admin surface could one day say "rewards are attested, not verified"
   * without anybody having to remember it.
   */
  verifiable: boolean;
  verify(input: { sessionId: string; userId: string; claim: unknown }): Promise<RewardVerification>;
}

/**
 * The provider in use: the member's own browser, saying the ad finished.
 *
 * It accepts the claim, because refusing it would mean the feature does not
 * work at all — and then leans entirely on the bindings around it (see the top
 * of this file) for its actual security. The name is deliberate: this is an
 * ATTESTATION, not a verification, and the two words should never be swapped in
 * this codebase.
 */
export const attestedRewardProvider: AiRewardProvider = {
  id: "client-attested",
  verifiable: false,
  async verify() {
    return {
      verified: true,
      providerRewardId: null,
      detail: "client-attested: no wired network can verify a web rewarded ad",
    };
  },
};

const PROVIDERS = new Map<string, AiRewardProvider>([[attestedRewardProvider.id, attestedRewardProvider]]);

/** Register a real provider here the day one exists. Nothing else changes. */
export function registerRewardProvider(provider: AiRewardProvider): void {
  PROVIDERS.set(provider.id, provider);
}

export function rewardProvider(id: string): AiRewardProvider | null {
  return PROVIDERS.get(id) ?? null;
}

/** The provider a new session is opened against. */
export function activeRewardProvider(): AiRewardProvider {
  return attestedRewardProvider;
}

export interface AiRewardSession {
  id: string;
  expiresAt: string;
  provider: string;
  /** Surfaced so an interface can be honest about what this is worth. */
  verifiable: boolean;
}

/**
 * Open a reward session.
 *
 * 🔴 Created SERVER-SIDE and returned by id. The browser never invents a
 * session, never names its feature and never sets its expiry — it receives an
 * opaque id that the database already knows belongs to this member, for this
 * feature, until a specific moment.
 */
export async function createAiRewardSession(opts: {
  userId: string;
  feature: AiFeature;
}): Promise<AiRewardSession> {
  const provider = activeRewardProvider();
  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + AI_REWARD_TTL_SECONDS * 1000).toISOString();

  const { data, error } = await admin
    .from("reward_sessions")
    .insert({
      user_id: opts.userId,
      // The feature binding. A download reward is a different value and can
      // never match the claim below.
      type: opts.feature,
      status: "pending",
      provider: provider.id,
      expires_at: expiresAt,
      payload: { feature: opts.feature },
    })
    .select("id, expires_at")
    .single();

  if (error || !data) {
    console.error("[ai/reward] session create failed", { code: error?.code, message: error?.message });
    throw new AiJobError("INTERNAL_ERROR", error?.message ?? "no reward session");
  }

  return {
    id: data.id as string,
    expiresAt: data.expires_at as string,
    provider: provider.id,
    verifiable: provider.verifiable,
  };
}

/**
 * The ad finished — mark the session granted.
 *
 * Separate from claiming it. Granting says "the reward happened"; claiming says
 * "this reward is now spent on that job". Keeping them apart is what lets the
 * claim be atomic at the moment of use rather than at the moment of the ad,
 * which is what closes the two-tabs race.
 */
export async function grantAiRewardSession(opts: {
  sessionId: string;
  userId: string;
  feature: AiFeature;
  claim?: unknown;
}): Promise<{ granted: boolean; reason?: string }> {
  const admin = createAdminClient();

  const { data: row, error: readError } = await admin
    .from("reward_sessions")
    .select("id, user_id, type, status, provider, expires_at, consumed_at")
    .eq("id", opts.sessionId)
    .maybeSingle();

  if (readError) {
    console.error("[ai/reward] grant read failed", { code: readError.code });
    throw new AiJobError("INTERNAL_ERROR", readError.message);
  }

  // 🔴 Ownership and feature are checked before the provider is even asked. A
  // session belonging to somebody else is not a provider question.
  if (!row || row.user_id !== opts.userId || row.type !== opts.feature) {
    return { granted: false, reason: "not-found" };
  }
  if (row.consumed_at) return { granted: false, reason: "already-consumed" };
  if (new Date(row.expires_at as string).getTime() <= Date.now()) return { granted: false, reason: "expired" };

  // Already granted and still unspent: idempotent, so a duplicated callback is
  // a no-op rather than a second reward.
  if (row.status === "granted") return { granted: true, reason: "already-granted" };

  const provider = rewardProvider((row.provider as string) ?? attestedRewardProvider.id) ?? attestedRewardProvider;
  const verification = await provider.verify({
    sessionId: opts.sessionId,
    userId: opts.userId,
    claim: opts.claim,
  });

  if (!verification.verified) {
    await admin.from("reward_sessions").update({ status: "expired" }).eq("id", opts.sessionId);
    console.warn("[ai/reward] verification refused", {
      sessionId: opts.sessionId,
      provider: provider.id,
      detail: verification.detail,
    });
    return { granted: false, reason: "rejected" };
  }

  const { error } = await admin
    .from("reward_sessions")
    .update({
      status: "granted",
      granted_at: new Date().toISOString(),
      provider_reward_id: verification.providerRewardId,
    })
    .eq("id", opts.sessionId)
    // Compare-and-set: only a still-pending session may be granted, so two
    // callbacks racing produce one grant.
    .eq("status", "pending");

  if (error) {
    // A unique violation here is a DUPLICATE PROVIDER CALLBACK arriving with an
    // id we have already honoured. Not an error — the desired outcome.
    if (error.code === "23505") return { granted: true, reason: "duplicate-callback" };
    console.error("[ai/reward] grant write failed", { code: error.code });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }

  console.info("[ai/reward] granted", {
    sessionId: opts.sessionId,
    userId: opts.userId,
    feature: opts.feature,
    provider: provider.id,
    verifiable: provider.verifiable,
  });
  return { granted: true };
}

export type RewardClaimReason =
  | "claimed"
  | "no-such-session"
  | "wrong-user"
  | "wrong-feature"
  | "already-consumed"
  | "expired"
  | "not-granted"
  | "unknown";

/**
 * Spend a reward on a job. Atomic, single-use, and the last word.
 *
 * 🔴 Every condition lives inside one UPDATE (see `claim_ai_reward` in
 * migration 0143). Two tabs claiming the same reward is not resolved by
 * whichever check runs first — the second UPDATE matches no row.
 *
 * Fails CLOSED: an unreachable database refuses the claim. The alternative
 * would be an outage that hands out free provider time.
 */
export async function claimAiReward(opts: {
  sessionId: string;
  userId: string;
  feature: AiFeature;
}): Promise<{ claimed: boolean; reason: RewardClaimReason }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("claim_ai_reward", {
        p_session_id: opts.sessionId,
        p_user_id: opts.userId,
        p_feature: opts.feature,
      })
      .single<{ claimed: boolean; reason: RewardClaimReason }>();

    if (error || !data) {
      // A PostgREST failure resolves as `{ error }` rather than throwing — a
      // standing trap on this project, and treating it as success here would
      // authorize a job on a claim that never happened.
      console.error("[ai/reward] claim failed", { code: error?.code, message: error?.message });
      return { claimed: false, reason: "unknown" };
    }
    if (!data.claimed) {
      console.warn("[ai/reward] claim refused", {
        sessionId: opts.sessionId,
        userId: opts.userId,
        reason: data.reason,
      });
    }
    return { claimed: data.claimed, reason: data.reason };
  } catch (e) {
    console.error("[ai/reward] claim threw", { error: String(e) });
    return { claimed: false, reason: "unknown" };
  }
}
