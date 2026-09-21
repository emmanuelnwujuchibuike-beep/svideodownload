import "server-only";

import { policyBlockEvent, screenAiJob } from "@/lib/ai/acceptable-use";
import { modeConfig, publicCharacterReplaceConfig, type CharacterReplaceConfig, type CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { REPLACEMENT_MODE_COPY, replacementModeLabel, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CreateCharacterReplaceJobRequest } from "@/lib/ai/character-replace/start-schema";
import { characterReplaceLimits, validatePhotoFile, validatePhotoFraming, validatePhotoPixels, validateVideoFile } from "@/lib/ai/character-replace/validate";
import type { AiEntitlement } from "@/lib/ai/entitlement";
import type { AiErrorCode } from "@/lib/ai/errors";
import { AI_ACTIVE_STATUSES, isActiveStatus, type AiFeatureDef, type AiJobRow } from "@/lib/ai/jobs";
import { createJob, getOwnJob, reserveSourcePath } from "@/lib/ai/job-store";
import { audioExtensionForUpload, extensionForUpload, imageExtensionForUpload } from "@/lib/ai/media";
import { applyProviderRoutes, characterReplaceProviderReady, resolveReplacementRoute } from "@/lib/ai/providers/resolve";
import { createSourceUploadTicket, type UploadTicket } from "@/lib/ai/storage-server";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { validateAudioFile } from "@/lib/ai/voice/audio-validate";
import { voiceCapabilities } from "@/lib/ai/voice/capabilities";
import { aiCurrencySymbol, type LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OPENING A CHARACTER REPLACE JOB — the create route's body, as functions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POST /api/ai/character-replace/jobs opened ONE job: the switches, the
 * member's entitlement, the files' facts against the mode's ceilings, the
 * acceptable-use screen, then the row and its signed upload tickets. The
 * multi-video batch route (2026-09-21) opens N with the same checks, so the
 * checks moved here and both routes call them — one place for "may this
 * member open this job", exactly as start-job.ts is one place for "may it
 * spend".
 *
 * Nothing here charges, uploads or submits. A job opened here is a DRAFT
 * (`queued`), expired by the sweep if never started.
 */

export type OpenRefusal = { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };
export type CreateFacts = Omit<CreateCharacterReplaceJobRequest, "clientRequestId" | "retryOf">;

export interface OpenContext {
  subject: AiSubject & { kind: "user" };
  feature: AiFeatureDef;
  settings: LandingSettings;
  entitlement: AiEntitlement;
  config: CharacterReplaceConfig;
  publicConfig: CharacterReplacePublicConfig;
}

function refuse(code: AiErrorCode, extra?: Record<string, unknown>): OpenRefusal {
  return { ok: false, code, extra };
}

/** The gate every create passes before any file is looked at: the tool is on, this member may use it, nothing is paused. */
export async function openGate(ctx: Omit<OpenContext, "publicConfig">, mode: ReplacementMode): Promise<OpenRefusal | { ok: true; publicConfig: CharacterReplacePublicConfig }> {
  const { config, entitlement, settings, subject } = ctx;
  // The provider AND the worker: a job that could not be prepared or submitted is not opened. 2026-09-21: "the provider" is whichever the router decides for this tool.
  if (!characterReplaceProviderReady(settings) || !hasWorker) return refuse("FEATURE_UNAVAILABLE", { error: "The AI service isn't connected yet." });
  // Part 10 §25: in `internal` launch mode only administrators may open a project; refused before any upload ticket exists.
  if (!(await launchAllows(config, subject))) return refuse("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });
  if (!config.enabled || !entitlement.allowed) return refuse("FEATURE_UNAVAILABLE");
  // Part 8 §2: the switches refuse a NEW project before any upload ticket is minted; results and history stay reachable.
  if (config.ops.maintenanceMode) return refuse("CR_MAINTENANCE", { error: config.ops.maintenanceMessage });
  if (!config.ops.processingEnabled) return refuse("CR_BUSY");
  const modeView = modeConfig(config, mode);
  if (!modeView.enabled) return refuse("FEATURE_UNAVAILABLE", { error: `${replacementModeLabel(mode)} isn't available right now.` });
  // 2026-09-21 (§4): a scope the decided engine cannot serve is refused before any upload ticket exists — nothing to pay for, an admin diagnostic in the log.
  const route = resolveReplacementRoute(mode, config, settings.frenzAiProviders);
  if (!route.supported || route.paused || !route.configured) {
    console.warn("[cr/open] refused — provider route", { subject: subject.key, mode, vendor: route.vendor, reason: route.diagnostic });
    return refuse(route.supported ? "PROVIDER_UNAVAILABLE" : "CR_SCOPE_UNAVAILABLE", { error: route.memberMessage ?? undefined });
  }
  const publicConfig = applyProviderRoutes(publicCharacterReplaceConfig(config, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, true, voiceCapabilities(config)), config, settings.frenzAiProviders);
  return { ok: true, publicConfig };
}

/**
 * The same rules the browser applied, applied again (§4) — sizes, types,
 * dimensions, framing — against the MODE's own ceilings (Part 6). Pure
 * validation; the worker measures the real files later.
 */
export function validateCreateFacts(ctx: OpenContext, mode: ReplacementMode, facts: CreateFacts, label = "That"): OpenRefusal | null {
  const { config, publicConfig } = ctx;
  const references = facts.references ?? [];
  const modeView = modeConfig(config, mode);
  const limits = characterReplaceLimits(publicConfig, mode);
  for (const [i, image] of [facts.photo, ...references].entries()) {
    const photoVerdict = validatePhotoFile({ size: image.size, type: image.mimeType, name: image.name }, limits);
    if (!photoVerdict.ok) return refuse(photoVerdict.code === "image-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
    const pixelsVerdict = validatePhotoPixels({ width: image.width, height: image.height }, limits);
    if (!pixelsVerdict.ok) return refuse("INVALID_INPUT", { error: i === 0 ? "That photo is too small." : `Reference photo ${i + 1} is too small.` });
    // 2026-09-20 (brief §3, §14): the photo's shape must fit the scope — a landscape photo cannot hold a standing person
    const framingVerdict = validatePhotoFraming({ width: image.width, height: image.height }, mode);
    if (!framingVerdict.ok) return refuse("INVALID_INPUT", { error: `${i === 0 ? "That photo" : `Reference photo ${i + 1}`} doesn't fit ${replacementModeLabel(mode)}. ${REPLACEMENT_MODE_COPY[mode].photo.best}` });
  }
  // Extra identity photos only where the mode takes them, and never more than the operator allows.
  if (references.length > Math.max(0, modeView.maximumReferenceImages - 1)) {
    return refuse("INVALID_INPUT", { error: `${replacementModeLabel(mode)} takes up to ${modeView.maximumReferenceImages} reference photo${modeView.maximumReferenceImages === 1 ? "" : "s"}.` });
  }
  const videoVerdict = validateVideoFile({ size: facts.video.size, type: facts.video.mimeType, name: facts.video.name }, limits);
  if (!videoVerdict.ok) return refuse(videoVerdict.code === "file-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT", { error: videoVerdict.code === "file-too-large" ? `${label} video is too large.` : `${label} video isn't a format we can use.` });
  // A replacement audio file (Part 6 §3): offered by the operator, within its size ceiling, a kind we take.
  if (facts.audio) {
    if (!config.voice.newVoiceEnabled || !config.audio.replacementEnabled) return refuse("FEATURE_UNAVAILABLE", { error: "Uploading your own audio isn't available right now." });
    const audioVerdict = validateAudioFile({ name: facts.audio.name, size: facts.audio.size, type: facts.audio.mimeType }, { maxBytes: config.audio.maximumUploadBytes });
    if (!audioVerdict.ok) return refuse(audioVerdict.code === "audio-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
    if (facts.audio.durationMs !== null && facts.audio.durationMs > config.audio.maximumDurationSeconds * 1000) return refuse("INVALID_INPUT", { error: `Audio can be up to ${config.audio.maximumDurationSeconds} seconds.` });
  }
  return null;
}

/** The acceptable-use screen reads the only member text there is: the filenames. */
export function screenCreateFacts(subjectKey: string, facts: CreateFacts): OpenRefusal | null {
  const references = facts.references ?? [];
  const policy = screenAiJob({ sourceName: `${facts.video.name} ${facts.photo.name} ${references.map((r) => r.name).join(" ")} ${facts.audio?.name ?? ""}`.trim(), sourceUrl: null, sourceKind: "upload" });
  if (!policy.allowed) {
    console.info("[cr/jobs] policy block", policyBlockEvent(policy.reason, subjectKey));
    return refuse("POLICY_BLOCKED");
  }
  return null;
}

/**
 * How many of the member's jobs are in flight — waiting or running, drafts
 * excluded (a draft is what is being made right now). The open-jobs ceiling
 * with the queue on is the operator's `maxVideosPerBatch`; with it off, the
 * Part 8 rule (one per concurrency slot) counts drafts too, as before.
 */
export async function countOpenJobs(subject: AiSubject & { kind: "user" }, feature: AiFeatureDef, opts: { includeDrafts: boolean }): Promise<number> {
  const db = await createClient();
  const statuses = opts.includeDrafts ? [...AI_ACTIVE_STATUSES] : AI_ACTIVE_STATUSES.filter((s) => s !== "queued");
  const { count, error } = await db.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", subject.userId).eq("feature", feature.id).in("status", statuses);
  if (error) {
    console.error("[cr/jobs] open count failed", { code: error.code, message: error.message });
    throw new Error(error.message);
  }
  return count ?? 0;
}

export interface JobLineage {
  attempt: number;
  projectId: string;
  retryOf: string;
  /** 0166: a retried batch job keeps its place in the batch. */
  batch: { id: string; index: number; size: number | null } | null;
}

/**
 * §7: a retry is a NEW attempt of the same project. `retryOf` must be this
 * member's own Character Replace job (the read runs as the member, so somebody
 * else's id reads as "no such job") and must be finished — a live job cannot
 * be "retried" into a second charge. The old row is never touched.
 */
export async function resolveLineage(subject: AiSubject, feature: AiFeatureDef, retryOf: string): Promise<JobLineage | OpenRefusal> {
  const prior = await getOwnJob(subject, retryOf);
  if (!prior || prior.feature !== feature.id || prior.metadata?.tool !== "character_replace") return refuse("INVALID_INPUT", { error: "That earlier attempt isn't yours to retry." });
  if (isActiveStatus(prior.status)) return refuse("JOB_ALREADY_PROCESSING");
  const priorAttempt = typeof prior.metadata?.attempt === "number" ? prior.metadata.attempt : 1;
  const priorBatch = (prior.metadata?.batch ?? null) as { size?: unknown } | null;
  return {
    attempt: priorAttempt + 1,
    projectId: typeof prior.metadata?.project_id === "string" ? prior.metadata.project_id : prior.id,
    retryOf: prior.id,
    batch: prior.batch_id ? { id: prior.batch_id, index: typeof prior.batch_index === "number" ? prior.batch_index : 1, size: typeof priorBatch?.size === "number" ? priorBatch.size : null } : null,
  };
}

export interface OpenedJob {
  row: AiJobRow;
  created: boolean;
  uploads: { video: UploadTicket; photo: UploadTicket; references: UploadTicket[]; voice: UploadTicket | null };
}

export async function mintUploadTickets(ownerId: string, feature: AiFeatureDef, jobId: string, facts: CreateFacts): Promise<OpenedJob["uploads"]> {
  const references = facts.references ?? [];
  const [videoTicket, photoTicket, ...rest] = await Promise.all([
    createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: extensionForUpload(facts.video.name, facts.video.mimeType), role: "source" }),
    createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: imageExtensionForUpload(facts.photo.name, facts.photo.mimeType), role: "character" }),
    ...references.map((r, i) => createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: imageExtensionForUpload(r.name, r.mimeType), role: "reference", index: i + 2 })),
    ...(facts.audio ? [createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: audioExtensionForUpload(facts.audio.name, facts.audio.mimeType), role: "voice" })] : []),
  ]);
  const referenceTickets = rest.slice(0, references.length);
  const voiceTicket = facts.audio ? (rest[references.length] ?? null) : null;
  return { video: videoTicket, photo: photoTicket, references: referenceTickets, voice: voiceTicket };
}

/**
 * The row, its tickets and the contract every later stage reads
 * (lib/ai/character-replace/job-meta.ts). Settings, trim and the quote land
 * at /start; the worker replaces the browser's facts with measured ones.
 */
export async function openCharacterReplaceJob(
  ctx: OpenContext,
  input: { clientRequestId: string; mode: ReplacementMode; facts: CreateFacts; lineage: JobLineage | null; batch: { id: string; index: number; size: number } | null },
): Promise<OpenedJob | OpenRefusal> {
  const { subject, feature, config, publicConfig } = ctx;
  const { facts, mode } = input;
  const references = facts.references ?? [];
  const ownerId = subjectOwnerId(subject);
  const batch = input.batch ?? input.lineage?.batch ?? null;

  const result = await createJob({
    subject,
    feature,
    source: { kind: "upload", size: facts.video.size, mimeType: facts.video.mimeType, durationSeconds: facts.video.durationMs / 1000, name: facts.video.name },
    clientRequestId: input.clientRequestId,
  });
  if (!result.created) {
    // A retry of the same create: the row it already made, with fresh tickets while it is still a draft.
    const uploads = result.row.status === "queued" ? await mintUploadTickets(ownerId, feature, result.row.id, facts) : null;
    if (!uploads) return refuse("JOB_ALREADY_PROCESSING", { jobId: result.row.id });
    return { row: result.row, created: false, uploads };
  }
  const uploads = await mintUploadTickets(ownerId, feature, result.row.id, facts);
  await reserveSourcePath(result.row.id, uploads.video.path);
  const { data, error } = await createAdminClient()
    .from("ai_jobs")
    .update({
      // Part 7 §21: the result window is the operator's (`retention.resultHours`), not the registry's constant.
      expires_at: new Date(Date.now() + config.retention.resultHours * 3_600_000).toISOString(),
      // 0166: the multi-video session, on the row itself (indexed) and in the contract (the size, for the board's "x of N").
      ...(batch ? { batch_id: batch.id, batch_index: batch.index } : {}),
      metadata: {
        ...(result.row.metadata ?? {}),
        tool: "character_replace",
        attempt: input.lineage?.attempt ?? 1,
        project_id: input.lineage?.projectId ?? result.row.id,
        retry_of: input.lineage?.retryOf ?? null,
        ...(batch ? { batch: { id: batch.id, index: batch.index, size: batch.size } } : {}),
        // Part 6: the mode, the extra references and the audio file the member will upload. Settings and the voice choice land at /start.
        mode,
        character: { path: uploads.photo.path, mime: facts.photo.mimeType.toLowerCase(), size: facts.photo.size, width: facts.photo.width, height: facts.photo.height, name: facts.photo.name.slice(0, 200) },
        references: references.map((r, i) => ({ path: uploads.references[i]!.path, mime: r.mimeType.toLowerCase(), size: r.size, width: r.width, height: r.height, name: r.name.slice(0, 200) })),
        video: { path: uploads.video.path, mime: facts.video.mimeType.toLowerCase(), size: facts.video.size, durationMs: facts.video.durationMs, width: facts.video.width, height: facts.video.height, hasAudio: facts.video.hasAudio },
        audio:
          facts.audio && uploads.voice
            ? { source: "upload", upload: { path: uploads.voice.path, mime: facts.audio.mimeType.toLowerCase(), size: facts.audio.size, durationMs: facts.audio.durationMs, name: facts.audio.name.slice(0, 200) }, tts: null, trimToFit: false, voiceConsent: false, prepared: null }
            : null,
        trim: null,
        settings: { quality: publicConfig.modes.find((m) => m.id === mode)?.defaultTier ?? publicConfig.defaultQuality, voiceMode: "original", lipSyncMode: null },
        quote: null,
        prepared: null,
        pipeline: null,
        provider: null,
      },
    })
    .eq("id", result.row.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[cr/jobs] metadata write failed", { jobId: result.row.id, message: error?.message ?? "no row" });
    return refuse("INTERNAL_ERROR");
  }
  const row = (await getOwnJob(subject, result.row.id)) ?? result.row;
  return { row, created: true, uploads };
}
