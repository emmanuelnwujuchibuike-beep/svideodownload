import { NextResponse } from "next/server";
import { z } from "zod";

import { AI_CLEAN_CONFIG, AI_CLEAN_LIMITS } from "@/lib/ai/config";
import { getAiEntitlement, usageForClient } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob, recordUploadedSource, transitionJob } from "@/lib/ai/job-store";
import { providerFor } from "@/lib/ai/providers";
import { claimAiReward } from "@/lib/ai/reward";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { peekAiUsage, releaseAiUsage, reserveAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/jobs/[id]/start — the upload is done; begin processing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The only endpoint that spends anything, and therefore the one whose ORDER
 * matters most.
 *
 *   1. identity + burst
 *   2. the job is this member's, and is still `queued`
 *   3. the OBJECT REALLY EXISTS, at the path the server chose, and is what it
 *      claims to be — the browser's numbers from creation are ignored here
 *   4. reserve the slot                    ← the first thing that costs
 *   5. submit to the provider
 *   6. on failure, RELEASE the slot and fail the job
 *   7. on success, record the prediction id and move to `processing`
 *
 * ── 🔴 WHY VALIDATION COMES BEFORE THE CHARGE ────────────────────────────────
 *
 * Everything that can refuse a job for the member's own reasons — no file, the
 * wrong file, too big — happens before step 4, so a rejected upload never costs
 * one of three daily runs. Everything that can fail for OUR reasons happens
 * after it, and every one of those paths releases.
 *
 * ── The body carries an authorization, and nothing else ──────────────────────
 *
 * One optional field: `rewardSessionId`. The path is still the server's, the
 * size and type are still read from storage, the model and its parameters are
 * still configuration — none of that is negotiable from a request.
 *
 * A reward id is not a parameter that changes what happens; it is a token the
 * database either honours or refuses, and it is worthless on its own. The
 * schema is `.strict()`, so a body carrying `plan`, `skipAd`, `remaining` or a
 * user id is REFUSED — the brief names exactly those, and a rejected field is
 * easier to reason about than a silently dropped one.
 *
 * ── 🔴 RESERVE FIRST, THEN CLAIM THE REWARD ──────────────────────────────────
 *
 * The order is deliberate and it is not interchangeable.
 *
 * Claiming first would mean that a member whose allowance ran out in another
 * tab burns their ad on a job that is then refused — attention spent for
 * nothing, which is the one outcome this flow must never produce. Reserving
 * first means the daily cap is the outer gate (an ad can never buy a fourth
 * clean), and a reward that turns out to be invalid simply releases the slot it
 * was holding. Both operations are single atomic statements, so two tabs racing
 * cannot both win either one.
 */

/** A job left `queued` this long with nothing uploaded is abandoned, not busy. */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

const bodySchema = z.object({ rewardSessionId: z.string().uuid().optional() }).strict();

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feat = aiFeature("ai_clean");
  if (!feat) return fail("FEATURE_UNAVAILABLE");

  /*
    🔴 THE ONE ENDPOINT THAT SPENDS MONEY, AND IT NO LONGER REQUIRES A SESSION.

    Owner, 2026-09-08: a guest gets 2 a day and must be able to actually run
    them. So the gate here is not "are you signed in" — it is the same gate it
    always was, resolved for whoever is asking: a real allowance in Postgres, an
    atomic reservation, a rewarded ad, and for guests an address ceiling on top.

    Nothing about the authorization got weaker; it got a second kind of subject.
    The identifier a guest presents is HMAC-signed and HttpOnly, so they cannot
    name anybody else's allowance, and they cannot invent an extra one of their
    own — only discard the one they have, which the ceiling then catches.
  */
  const resolution = await resolveAiSubject(_request, feat.id);
  const { subject } = resolution;

  const burst = await aiJobCreateLimiter.limit(`ai-start:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  // An absent body is fine — it is how a plan that owes no ad starts a job.
  let rewardSessionId: string | undefined;
  try {
    const raw = await _request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return fail("INVALID_INPUT");
    rewardSessionId = parsed.data.rewardSessionId;
  } catch {
    /* no body at all */
  }

  try {
    /* 2 · OWNERSHIP. Read as the member, so RLS decides, plus an id filter. */
    const job = await getOwnJob(subject, id);
    if (!job) return fail("JOB_NOT_FOUND");

    const feature = aiFeature(job.feature);
    if (!feature) return fail("FEATURE_UNAVAILABLE");

    // Already running or finished. Returning the job rather than an error makes
    // a double-tap on "Continue" harmless — the second call is a no-op that
    // answers with the same state the first produced.
    if (job.status !== "queued") {
      return NextResponse.json({ job: jobToView(job, storedErrorMessage), started: false });
    }

    const provider = providerFor(feature.provider);
    if (!provider || !provider.isConfigured()) return fail("FEATURE_UNAVAILABLE");

    /*
      3 · THE FILE ITSELF.

      🔴 The path comes from the ROW, where the server wrote it when it minted
      the upload ticket — never from the request. `pathBelongsTo` re-checks that
      it starts with this member's id and this job's id, because the value is
      about to become a signed URL handed to a third party, and "it was in the
      database" is not on its own a statement about whose it is.
    */
    const expectedPath = job.source_path;
    if (!expectedPath || !pathBelongsTo(expectedPath, subjectOwnerId(subject), job.id)) {
      // No reserved key, or one that does not belong to this member and this
      // job. Either is a row that should not exist; refusing beats acting on it.
      console.error("[ai/jobs] source path failed ownership", { jobId: job.id, subject: subject.key });
      return fail("INTERNAL_ERROR");
    }

    const stored = await statSourceObject(expectedPath);
    if (!stored) {
      // Nothing was uploaded. Not a failure of the job — the member simply has
      // not finished, or the upload died — so the job stays `queued` and
      // nothing is charged.
      const age = Date.now() - Date.parse(job.created_at);
      return fail("INVALID_INPUT", {
        error: age > ABANDONED_AFTER_MS ? "That upload didn't finish. Choose the video again." : "The upload hasn't finished yet.",
      });
    }

    if (stored.size <= 0) return fail("INVALID_INPUT");
    if (stored.size > AI_CLEAN_LIMITS.maxFileSize) return fail("FILE_TOO_LARGE");
    if (stored.mimeType && !AI_CLEAN_LIMITS.allowedMimeTypes.includes(stored.mimeType.toLowerCase())) {
      return fail("UNSUPPORTED_FORMAT");
    }

    // What was really stored replaces what the browser claimed at creation.
    await recordUploadedSource(job.id, {
      path: expectedPath,
      size: stored.size,
      mimeType: stored.mimeType,
    });

    /* 4 · THE CHARGE. Atomic, and the first thing here that costs anything. */
    const entitlement = await getAiEntitlement(subject, feature);
    if (!entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    /*
      🔴 THE ADDRESS CEILING RIDES ALONG, IN THE SAME TRANSACTION.

      `ipCeiling` is null for a signed-in member and a number for a guest. Both
      limits are applied inside one SQL function (migration 0145), so a guest
      cycling cookies cannot slip between two separate checks — and a shared
      carrier NAT is never mistaken for one abuser, because the ceiling is set
      six times a single visitor's allowance.
    */
    const reservation = await reserveAiUsage(
      subject,
      feature.id,
      entitlement.dailyLimit,
      entitlement.ipCeiling && resolution.ipKey
        ? { key: resolution.ipKey, limit: entitlement.ipCeiling }
        : null,
    );
    if (!reservation.allowed) {
      return fail("DAILY_LIMIT_REACHED", { usage: usageForClient(entitlement, reservation.used) });
    }

    /*
      4b · THE REWARD GATE.

      🔴 The slot is already held, so nothing here can be bypassed by racing —
      and every refusal below releases it, because a member who could not spend
      a reward has not had a clean.

      `entitlement.requiresReward` comes from the plan policy, never from the
      request. Part 10 turns it on for the paid plans by editing a row in
      lib/ai/policy.ts; not a line of this changes.
    */
    if (entitlement.requiresReward) {
      if (!rewardSessionId) {
        await releaseAiUsage(subject, feature.id, entitlement.dailyLimit);
        return fail("REWARD_REQUIRED", { usage: usageForClient(entitlement, reservation.used) });
      }

      const claim = await claimAiReward({ sessionId: rewardSessionId, subject, feature: feature.id });
      if (!claim.claimed) {
        await releaseAiUsage(subject, feature.id, entitlement.dailyLimit);
        console.warn("[ai/jobs] reward claim refused", {
          jobId: job.id,
          subject: subject.key,
          feature: feature.id,
          reason: claim.reason,
          released: true,
        });
        // One sentence whatever the reason — see REWARD_INVALID's copy.
        return fail("REWARD_INVALID");
      }

      console.info("[ai/jobs] reward claimed", {
        jobId: job.id,
        subject: subject.key,
        feature: feature.id,
        rewardSessionId,
      });
    }

    /* 5 · THE PROVIDER. Everything from here releases on failure. */
    try {
      const sourceUrl = await signSourceUrl(expectedPath);
      const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(_request.url).origin;

      const state = await provider.submit({
        jobId: job.id,
        feature,
        sourceUrl,
        webhookUrl: `${origin}/api/ai/replicate/webhook`,
      });

      const updated = await transitionJob(job.id, ["queued"], "processing", {
        replicate_prediction_id: state.reference,
        model: AI_CLEAN_CONFIG.model,
        // What ACTUALLY ran, as the provider reported it — not our intention.
        model_version: state.modelVersion,
        started_at: new Date().toISOString(),
      });

      console.info("[ai/jobs] started", {
        jobId: job.id,
        subject: subject.key,
        feature: feature.id,
        provider: feature.provider,
        model: AI_CLEAN_CONFIG.model,
        modelVersion: state.modelVersion,
        predictionId: state.reference,
        transition: "queued -> processing",
      });

      return NextResponse.json({
        job: jobToView(updated ?? { ...job, status: "processing" }, storedErrorMessage),
        started: true,
        usage: usageForClient(entitlement, reservation.used),
      });
    } catch (providerError) {
      /*
        🔴 OURS OR THE PROVIDER'S — SO IT IS FREE.

        The slot goes back, the job is marked failed with a code, and the
        member is told they can try again. Charging somebody for the moment our
        provider was unreachable is the single most corrosive thing a metered
        feature can do.
      */
      await releaseAiUsage(subject, feature.id, entitlement.dailyLimit);
      const code = isAiJobError(providerError) ? providerError.code : "PROVIDER_ERROR";
      const detail = isAiJobError(providerError) ? providerError.detail : String(providerError);

      await transitionJob(job.id, ["queued"], "failed", {
        error_code: code,
        error_message: detail?.slice(0, 2000) ?? null,
        completed_at: new Date().toISOString(),
      });

      console.error("[ai/jobs] provider submit failed", {
        jobId: job.id,
        subject: subject.key,
        feature: feature.id,
        code,
        transition: "queued -> failed",
        released: true,
      });

      // The adapter's classification survives to the member: an out-of-credit
      // provider must not be reported as something a retry could fix.
      const surfaced =
        code === "FEATURE_UNAVAILABLE" || code === "PROVIDER_UNAVAILABLE" ? code : "PROVIDER_ERROR";
      return fail(surfaced, {
        usage: usageForClient(entitlement, (await peekAiUsage(subject, feature.id)).usedToday),
      });
    }
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/jobs] start failed", { subject: subject.key, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/jobs] start threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
