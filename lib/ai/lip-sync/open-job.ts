import "server-only";

import { policyBlockEvent, screenAiJob } from "@/lib/ai/acceptable-use";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { CHARACTER_REPLACE_VIDEO_FORMATS } from "@/lib/ai/character-replace/validate";
import type { AiEntitlement } from "@/lib/ai/entitlement";
import type { AiErrorCode } from "@/lib/ai/errors";
import { AI_ACTIVE_STATUSES, type AiFeatureDef, type AiJobRow } from "@/lib/ai/jobs";
import { createJob, getOwnJob, reserveSourcePath } from "@/lib/ai/job-store";
import { LIP_SYNC_AUDIO_FORMATS, type LipSyncProConfig, type LipSyncPublicConfig } from "@/lib/ai/lip-sync/config";
import { planSpeechPath, publicLipSyncConfig, resolveLipSyncProRoute, textPathReady } from "@/lib/ai/lip-sync/providers/router";
import type { CreateLipSyncJobRequest } from "@/lib/ai/lip-sync/schemas";
import { audioExtensionForUpload, extensionForUpload } from "@/lib/ai/media";
import { createSourceUploadTicket, type UploadTicket } from "@/lib/ai/storage-server";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { aiCurrencySymbol, type LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OPEN A LIP SYNC PRO JOB — the gate, the checks, the row, the tickets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Character Replace create core's shape (lib/ai/character-replace/
 * open-job.ts), for this tool: nothing is charged, nothing is sent; the row
 * is opened with its contract and the browser gets signed upload tickets —
 * the video, and the audio file when that is the speech source (§2). Text
 * travels in the body and lands on the row; it is never uploaded.
 *
 * §3 is enforced by the schema (a discriminated union) and again here: a
 * body cannot carry both a text and an audio file, nor neither.
 */
export interface LipSyncOpenContext {
  subject: AiSubject & { kind: "user" };
  feature: AiFeatureDef;
  settings: LandingSettings;
  entitlement: AiEntitlement;
  config: LipSyncProConfig;
  publicConfig: LipSyncPublicConfig;
}
export type LipSyncOpenRefusal = { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };
export interface LipSyncOpenedJob {
  row: AiJobRow;
  created: boolean;
  uploads: { video: UploadTicket; audio: UploadTicket | null };
}
export type LipSyncCreateFacts = Omit<CreateLipSyncJobRequest, "clientRequestId" | "retryOf">;

const refuse = (code: AiErrorCode, extra?: Record<string, unknown>): LipSyncOpenRefusal => ({ ok: false, code, extra });

/** The gate every create passes: the tool is on for this member, a provider can run it, the worker is there, nothing is paused. */
export async function openLipSyncGate(ctx: Omit<LipSyncOpenContext, "publicConfig">, source: "text" | "audio"): Promise<LipSyncOpenRefusal | { ok: true; publicConfig: LipSyncPublicConfig }> {
  const { config, entitlement, settings, subject } = ctx;
  const cr = settings.frenzAiCharacterReplace;
  if (!hasWorker) return refuse("FEATURE_UNAVAILABLE", { error: "The AI service isn't connected yet." });
  // the Character Replace kill switches govern every paid AI tool (maintenance, processing pause, launch mode)
  if (!(await launchAllows(cr, subject))) return refuse("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });
  if (!config.enabled || !entitlement.allowed) return refuse("FEATURE_UNAVAILABLE");
  if (cr.ops.maintenanceMode) return refuse("CR_MAINTENANCE", { error: cr.ops.maintenanceMessage });
  if (!cr.ops.processingEnabled) return refuse("CR_BUSY");
  const route = resolveLipSyncProRoute(config, settings.frenzAiProviders);
  if (!route.adapter || !route.enabled || !route.configured || route.paused) {
    console.warn("[lipsync/open] refused — provider route", { subject: subject.key, vendor: route.vendor, reason: route.diagnostic });
    return refuse("PROVIDER_UNAVAILABLE", { error: "Lip Sync Pro is temporarily unavailable. Try again in a few minutes — nothing has been charged." });
  }
  if (source === "text" && !textPathReady(config, route.adapter)) return refuse("FEATURE_UNAVAILABLE", { error: "Typing what they should say isn't available right now. Upload an audio file instead." });
  if (source === "audio" && (!config.audioMode.enabled || !route.adapter.capabilities.supports_audio)) return refuse("FEATURE_UNAVAILABLE", { error: "Uploading your own audio isn't available right now." });
  return { ok: true, publicConfig: publicLipSyncConfig(config, settings.frenzAiProviders, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }) };
}

/** The browser's facts, checked again against the operator's ceilings — sizes, kinds, lengths (§16). The worker measures the real files later. */
export function validateLipSyncFacts(ctx: LipSyncOpenContext, facts: LipSyncCreateFacts): LipSyncOpenRefusal | null {
  const { config, publicConfig } = ctx;
  const v = facts.video;
  const videoType = v.mimeType.toLowerCase().split(";")[0]!.trim();
  const videoExt = (v.name.split(".").pop() ?? "").toLowerCase();
  const knownVideo = CHARACTER_REPLACE_VIDEO_FORMATS.some((f) => f.mimeTypes.includes(videoType) || f.extension === videoExt);
  if (!knownVideo) return refuse("UNSUPPORTED_FORMAT", { error: "That video isn't a format we can use." });
  if (v.size > Math.min(ctx.feature.maxBytes, publicConfig.video.maximumUploadBytes)) return refuse("FILE_TOO_LARGE", { error: "That video is too large." });
  if (v.width * v.height > config.video.maximumPixels) return refuse("INVALID_INPUT", { error: "That video's resolution is higher than this tool takes." });
  if (v.durationMs > publicConfig.video.maximumDurationSeconds * 1000) return refuse("INVALID_INPUT", { error: `Videos can be up to ${publicConfig.video.maximumDurationSeconds} seconds here. Trim it first.`, limit: "too_long" });
  if (v.durationMs < publicConfig.video.minimumDurationSeconds * 1000) return refuse("INVALID_INPUT", { error: `Videos need at least ${publicConfig.video.minimumDurationSeconds} second${publicConfig.video.minimumDurationSeconds === 1 ? "" : "s"} here.`, limit: "too_short" });

  if (facts.speech.source === "text") {
    const text = facts.speech.text.trim();
    if (text.length < config.textMode.minimumCharacters) return refuse("INVALID_INPUT", { error: "Type what they should say." });
    if (text.length > config.textMode.maximumCharacters) return refuse("INVALID_INPUT", { error: `Keep the text to ${config.textMode.maximumCharacters} characters.` });
    const speed = facts.speech.speed ?? config.textMode.speed.default;
    if (speed < config.textMode.speed.min || speed > config.textMode.speed.max) return refuse("INVALID_INPUT", { error: `Speed goes from ${config.textMode.speed.min}× to ${config.textMode.speed.max}×.` });
  } else {
    const a = facts.speech.audio;
    const type = a.mimeType.toLowerCase().split(";")[0]!.trim();
    const ext = (a.name.split(".").pop() ?? "").toLowerCase();
    const known = LIP_SYNC_AUDIO_FORMATS.filter((f) => config.audioMode.formats.includes(f.id)).some((f) => f.mimeTypes.includes(type) || f.extensions.includes(ext));
    if (!known) return refuse("UNSUPPORTED_FORMAT", { error: `Audio can be ${config.audioMode.formats.map((f) => f.toUpperCase()).join(", ")}.` });
    if (a.size <= 0) return refuse("INVALID_INPUT", { error: "That audio file is empty." });
    if (a.size > config.audioMode.maximumUploadBytes) return refuse("FILE_TOO_LARGE", { error: "That audio file is too large." });
    if (a.durationMs !== null && a.durationMs > config.audioMode.maximumDurationSeconds * 1000) return refuse("INVALID_INPUT", { error: `Audio can be up to ${config.audioMode.maximumDurationSeconds} seconds.` });
  }
  return null;
}

/** The acceptable-use screen reads the member's text (the filenames, and the dialogue itself). */
export function screenLipSyncFacts(subjectKey: string, facts: LipSyncCreateFacts): LipSyncOpenRefusal | null {
  const words = facts.speech.source === "text" ? facts.speech.text : facts.speech.audio.name;
  const policy = screenAiJob({ sourceName: `${facts.video.name} ${words}`.trim(), sourceUrl: null, sourceKind: "upload" });
  if (!policy.allowed) {
    console.info("[lipsync/jobs] policy block", policyBlockEvent(policy.reason, subjectKey));
    return refuse("POLICY_BLOCKED");
  }
  return null;
}

export async function countOpenLipSyncJobs(subject: AiSubject & { kind: "user" }, feature: AiFeatureDef): Promise<number> {
  const { count, error } = await createAdminClient().from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", subject.userId).eq("feature", feature.id).in("status", [...AI_ACTIVE_STATUSES]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function mintLipSyncUploadTickets(ownerId: string, feature: AiFeatureDef, jobId: string, facts: LipSyncCreateFacts): Promise<LipSyncOpenedJob["uploads"]> {
  const [video, audio] = await Promise.all([
    createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: extensionForUpload(facts.video.name, facts.video.mimeType), role: "source" }),
    facts.speech.source === "audio" ? createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: audioExtensionForUpload(facts.speech.audio.name, facts.speech.audio.mimeType), role: "voice" }) : Promise.resolve(null),
  ]);
  return { video, audio };
}

export async function openLipSyncJob(ctx: LipSyncOpenContext, input: { clientRequestId: string; facts: LipSyncCreateFacts; lineage: { projectId: string; attempt: number; retryOf: string } | null }): Promise<LipSyncOpenedJob | LipSyncOpenRefusal> {
  const { subject, feature, config, settings } = ctx;
  const { facts } = input;
  const ownerId = subjectOwnerId(subject);
  const route = resolveLipSyncProRoute(config, settings.frenzAiProviders);
  const path = facts.speech.source === "text" ? planSpeechPath("text", route.adapter) : null;

  const result = await createJob({
    subject,
    feature,
    source: { kind: "upload", size: facts.video.size, mimeType: facts.video.mimeType, durationSeconds: facts.video.durationMs / 1000, name: facts.video.name },
    clientRequestId: input.clientRequestId,
  });
  if (!result.created) {
    const uploads = result.row.status === "queued" ? await mintLipSyncUploadTickets(ownerId, feature, result.row.id, facts) : null;
    if (!uploads) return refuse("JOB_ALREADY_PROCESSING", { jobId: result.row.id });
    return { row: result.row, created: false, uploads };
  }
  const uploads = await mintLipSyncUploadTickets(ownerId, feature, result.row.id, facts);
  await reserveSourcePath(result.row.id, uploads.video.path);
  const { data, error } = await createAdminClient()
    .from("ai_jobs")
    .update({
      expires_at: new Date(Date.now() + settings.frenzAiCharacterReplace.retention.resultHours * 3_600_000).toISOString(),
      metadata: {
        ...(result.row.metadata ?? {}),
        tool: "lip_sync",
        attempt: input.lineage?.attempt ?? 1,
        project_id: input.lineage?.projectId ?? result.row.id,
        retry_of: input.lineage?.retryOf ?? null,
        video: { path: uploads.video.path, mime: facts.video.mimeType.toLowerCase(), size: facts.video.size, durationMs: facts.video.durationMs, width: facts.video.width, height: facts.video.height, hasAudio: facts.video.hasAudio ?? null },
        speech:
          facts.speech.source === "text"
            ? { source: "text", text: facts.speech.text.trim(), voiceId: facts.speech.voiceId ?? null, providerVoiceId: null, languageCode: facts.speech.languageCode ?? null, speed: facts.speech.speed ?? config.textMode.speed.default, path }
            : { source: "audio", upload: { path: uploads.audio!.path, mime: facts.speech.audio.mimeType.toLowerCase(), size: facts.speech.audio.size, durationMs: facts.speech.audio.durationMs, name: facts.speech.audio.name.slice(0, 200) } },
        settings: {
          expression: config.expression.enabled && route.adapter?.capabilities.supports_temperature ? (facts.settings?.expression ?? config.expression.default) : null,
          activeSpeaker: config.activeSpeaker.enabled && route.adapter?.capabilities.supports_active_speaker ? (facts.settings?.activeSpeaker ?? config.activeSpeaker.default) : false,
          durationPolicy: config.duration.policy,
        },
        trim: null,
        quote: null,
        prepared: null,
        audio: null,
        pipeline: null,
      },
    })
    .eq("id", result.row.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[lipsync/jobs] metadata write failed", { jobId: result.row.id, message: error?.message ?? "no row" });
    return refuse("INTERNAL_ERROR");
  }
  const row = (await getOwnJob(subject, result.row.id)) ?? result.row;
  return { row, created: true, uploads };
}
