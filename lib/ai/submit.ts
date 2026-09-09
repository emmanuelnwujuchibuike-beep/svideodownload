import "server-only";

import { AI_CLEAN_CONFIG } from "@/lib/ai/config";
import { AiJobError } from "@/lib/ai/errors";
import type { AiFeatureDef, AiJobRow, AiJobStatus } from "@/lib/ai/jobs";
import { transitionJob } from "@/lib/ai/job-store";
import { providerFor } from "@/lib/ai/providers";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HANDING A JOB TO THE PROVIDER — the one implementation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from `/api/ai/jobs/[id]/start` in Part 6, because a second caller
 * appeared: a URL job is submitted AFTER the worker has fetched the video, not
 * when the member pressed the button, so the same eight decisions had to happen
 * from a different place.
 *
 * Copying them would have meant two places that each know the engine is
 * resolved once at submit, that the model version recorded is the provider's
 * answer rather than our intention, and that the transition is a compare-and-set
 * with an explicit `from`. The second copy is always the one that forgets.
 *
 * ── 🔴 THE CALLER OWNS THE MONEY, THIS OWNS THE SUBMISSION ──────────────────
 *
 * Reserving the allowance, claiming a reward and RELEASING on failure all stay
 * with the caller. That split is deliberate: the two callers hold different
 * things at the point of failure — `/start` still has the member's request open
 * and can answer it, while the worker callback has only the row. What they must
 * not differ on is what gets sent to Replicate, which is what lives here.
 *
 * This THROWS on failure. It does not release, it does not fail the job, it
 * does not swallow. The caller decides, because only the caller knows whether
 * anything was charged.
 */

export interface ProviderSubmission {
  /** The provider's own id for the run, recorded so it can be reconciled. */
  reference: string;
  modelVersion: string | null;
  engine: string;
}

/**
 * Sign the source, resolve the engine, submit, and move the row forward.
 *
 * `from` is the status the job must currently be in — `["queued"]` for an
 * upload, `["acquiring"]` for a link. Passing it rather than assuming is what
 * makes this safe to call from two places: the compare-and-set means a job that
 * has moved on (cancelled in another tab, swept by the stall guard) matches no
 * row and this reports it rather than resurrecting it.
 */
export async function submitJobToProvider(
  job: AiJobRow,
  feature: AiFeatureDef,
  opts: { from: readonly AiJobStatus[]; origin?: string },
): Promise<{ submission: ProviderSubmission; row: AiJobRow | null }> {
  const provider = providerFor(feature.provider);
  if (!provider || !provider.isConfigured()) {
    throw new AiJobError("FEATURE_UNAVAILABLE", "no configured provider for this feature");
  }

  const sourcePath = job.source_path;
  if (!sourcePath) {
    throw new AiJobError("INTERNAL_ERROR", "cannot submit a job with no stored source");
  }

  /*
    Two hours, not ten minutes. This model runs on CPU and is often cold, so a
    prediction can sit in Replicate's queue for tens of minutes before it
    fetches the file — a short-lived url would expire mid-queue and the run
    would fail for a reason that looks like a missing file.
  */
  const sourceUrl = await signSourceUrl(sourcePath);

  /*
    ── 🔴 THE ENGINE IS RESOLVED ONCE, HERE, AND RECORDED ON THE JOB ─────────

    The admin setting is the authority; the environment variable is the
    fallback for a deploy with no settings row yet. Read at SUBMIT time and
    written to the row, because the worker finishes this job minutes later and
    must not ask the setting again — an operator flipping the switch in between
    would otherwise leave a job detected with the classical fill (already
    smeared) and then "reconstructed" from that smear.
  */
  const { frenzAiEngine } = await getLandingSettings();

  /*
    The webhook address. `SITE_URL` rather than the request's own origin,
    because one of the two callers is the WORKER, whose origin is the worker's
    hostname — a webhook pointed there would reach a machine with no Replicate
    signing secret and no job routes. The caller may still override it, which
    is what keeps `/start` able to use its own origin on a preview deploy.
  */
  const origin = (opts.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL).replace(/\/$/, "");

  const state = await provider.submit({
    jobId: job.id,
    feature,
    sourceUrl,
    webhookUrl: `${origin}/api/ai/replicate/webhook`,
    engine: frenzAiEngine,
  });

  const row = await transitionJob(job.id, opts.from, "processing", {
    replicate_prediction_id: state.reference,
    model: AI_CLEAN_CONFIG.model,
    // The engine this job was STARTED on. The worker reads it back rather than
    // re-reading a setting that may have moved.
    metadata: { ...(job.metadata ?? {}), engine: frenzAiEngine },
    // What ACTUALLY ran, as the provider reported it — not our intention.
    model_version: state.modelVersion,
    started_at: new Date().toISOString(),
  });

  return {
    submission: { reference: state.reference, modelVersion: state.modelVersion, engine: frenzAiEngine },
    row,
  };
}
