import { AI_AUDIENCES, type AiAudience } from "@/lib/ai/audience";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH SILICON RUNS THIS JOB
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "wire the route and pipeline so pro users and business
 * users and any higher plan yet to come to use gpu while free use cpu."
 *
 * ── 🔴 A THRESHOLD, NOT A LIST ──────────────────────────────────────────────
 *
 * "and any higher plan yet to come" is the whole design note. `AI_AUDIENCES` is
 * declared in ASCENDING order of privilege, so the rule is an index comparison
 * against `pro` — and a tier appended above `pro` tomorrow gets GPU without
 * anybody remembering to edit this file.
 *
 * The alternative, `["pro","business","max_ai"].includes(audience)`, is a list
 * that goes stale silently: a new top tier would quietly get the FREE hardware,
 * which is the most expensive direction for that mistake to fall.
 *
 * ── 🔴 IT FAILS DOWN TO CPU, ALWAYS ─────────────────────────────────────────
 *
 * `gpuConfigured` is passed in rather than read here, and when it is false
 * EVERY audience gets CPU. That matters because the GPU model does not
 * currently exist: the one published on 2026-09-08 was disabled by Replicate
 * ("consistently fails to complete setup") and the pipeline stayed on the CPU
 * model deliberately, because a feature that returns a mediocre result beats
 * one that never returns.
 *
 * So this ships the ROUTING now and the hardware follows whenever a working GPU
 * model is configured. Until then nothing changes for anybody, and — this is
 * the part that matters — nothing anywhere promises a member a speed they are
 * not getting. See `aiCleanGpuOffered`, which is what gates the marketing claim
 * on the capability actually existing.
 *
 * Pure: no env reads, no network, no clock.
 */

export type AiHardware = "cpu" | "gpu";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MODEL TIER — which engine a plan gets, not just which silicon
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "make the new plan thats yet to be built it will be called
 * max ai and max ai will use BRIA model... while pro and business uses just gpu
 * and not BRIA."
 *
 * Three rungs, and they are NOT the same axis as `AiHardware`:
 *
 *   standard  the CPU model. Guest and free.
 *   gpu       the same class of model on faster hardware. Pro, Business.
 *   bria      a different, better model entirely. Max AI only.
 *
 * 🔴 A separate concept from hardware because "faster" and "more accurate" are
 * different promises and are sold separately. Collapsing them into one enum
 * would mean the day BRIA runs on something other than a GPU — or a GPU model
 * ships before BRIA does, which is the actual sequence here — the tiering
 * silently says the wrong thing to somebody paying for it.
 */
export type AiModelTier = "standard" | "gpu" | "bria";

/**
 * The lowest audience that gets the faster hardware.
 *
 * Guest and free sit below it. Everything from `pro` up sits at or above it.
 */
const GPU_FROM: AiAudience = "pro";

const RANK = new Map<AiAudience, number>(AI_AUDIENCES.map((a, i) => [a, i]));

/** True when this audience is entitled to GPU, IF a GPU model is configured. */
export function audienceGetsGpu(audience: AiAudience): boolean {
  const rank = RANK.get(audience);
  const floor = RANK.get(GPU_FROM);
  // An unknown audience is treated as the least privileged, never the most —
  // the same direction `resolveAiAudience` already errs in.
  if (rank === undefined || floor === undefined) return false;
  return rank >= floor;
}

/**
 * What this job will actually run on.
 *
 * Both inputs matter and neither is sufficient alone: an entitled member on a
 * deployment with no GPU model gets CPU, and a free member on a deployment with
 * one also gets CPU.
 */
export function hardwareFor(
  audience: AiAudience,
  opts: { gpuConfigured: boolean },
): AiHardware {
  if (!opts.gpuConfigured) return "cpu";
  return audienceGetsGpu(audience) ? "gpu" : "cpu";
}

/**
 * Whether "faster processing on Pro" may be SAID to anybody.
 *
 * 🔴 Separate from `hardwareFor` on purpose, and it is the honesty gate. A
 * paid tier is entitled to GPU whether or not one is deployed; the claim may
 * only appear when there is a GPU model behind it. Selling a speed tier that
 * does not exist is the one promise a member can check in a minute and find
 * false — and it would be the first thing they blamed when a Pro job took just
 * as long as a free one.
 */
export function aiCleanGpuOffered(opts: { gpuConfigured: boolean }): boolean {
  return opts.gpuConfigured;
}

/** The audience that gets the BRIA model. Exactly one, by name, on purpose. */
const BRIA_AUDIENCE: AiAudience = "max_ai";

/**
 * Whether this audience is entitled to BRIA.
 *
 * 🔴 A NAME, not a threshold — the opposite of `audienceGetsGpu` above, and the
 * difference is deliberate. GPU is "this tier and everything above it", so a
 * future top tier should inherit it automatically. BRIA is the DEFINING feature
 * of one specific plan; a tier added above Max AI later must be given it by a
 * decision, not by an accident of ordering, because the model costs money per
 * run and "everything above" is not a pricing statement anybody made.
 */
export function audienceGetsBria(audience: AiAudience): boolean {
  return audience === BRIA_AUDIENCE;
}

/**
 * The model tier a job should actually run on.
 *
 * Both capabilities are passed in, and each falls DOWN independently: a Max AI
 * member on a deployment with no BRIA model gets the GPU model if there is one
 * and the standard model if there is not. Nobody is ever refused a video
 * because the tier they paid for is not deployed yet.
 */
export function modelTierFor(
  audience: AiAudience,
  opts: { gpuConfigured: boolean; briaConfigured: boolean },
): AiModelTier {
  if (opts.briaConfigured && audienceGetsBria(audience)) return "bria";
  if (opts.gpuConfigured && audienceGetsGpu(audience)) return "gpu";
  return "standard";
}

/**
 * Whether "Max AI is more accurate" may be SAID to anybody.
 *
 * Same honesty gate as `aiCleanGpuOffered`, for the same reason: the label goes
 * up when the model exists behind it, and not before.
 */
export function aiCleanBriaOffered(opts: { briaConfigured: boolean }): boolean {
  return opts.briaConfigured;
}
