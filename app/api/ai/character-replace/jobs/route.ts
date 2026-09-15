import { NextResponse } from "next/server";

import { policyBlockEvent, screenAiJob } from "@/lib/ai/acceptable-use";
import { modeConfig, publicCharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { replacementModeLabel } from "@/lib/ai/character-replace/modes";
import { createCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";
import { characterReplaceLimits, validatePhotoFile, validatePhotoPixels, validateVideoFile } from "@/lib/ai/character-replace/validate";
import { validateAudioFile } from "@/lib/ai/voice/audio-validate";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isActiveStatus, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { countActiveJobs, createJob, findJobByRequestId, getOwnJob, reserveSourcePath } from "@/lib/ai/job-store";
import { audioExtensionForUpload, extensionForUpload, imageExtensionForUpload } from "@/lib/ai/media";
import { hasProviderFor } from "@/lib/ai/providers";
import { createSourceUploadTicket } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs — open a job, mint TWO upload tickets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Step 7's first half. Nothing is charged here and nothing is sent anywhere:
 * this opens the row (`ai_jobs`, feature `ai_character_replace`) and hands
 * the browser two signed, single-object upload URLs — the video and the
 * character image — into the member's own folder of the private source
 * bucket (§39: browser → storage, never browser → server → provider). The
 * charge, the checks that spend money and the hand-off to the worker all
 * happen at /start, once both files are in place.
 *
 * Idempotent on `clientRequestId`: a retry returns the row it already made,
 * with fresh tickets, so a lost response never opens a second job.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-cr-job:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createCharacterReplaceJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { clientRequestId, photo, video, retryOf, audio } = parsed.data;
  // Part 6: which replacement. Absent = Full Character, so every client from Parts 1–5 still creates.
  const mode = parsed.data.mode ?? "full_character";
  const references = parsed.data.references ?? [];
  if (!isValidClientRequestId(clientRequestId)) return fail("INVALID_INPUT");

  // The provider AND the worker: a job that could not be prepared or submitted is not opened.
  if (!hasProviderFor(feature) || !hasWorker) return fail("FEATURE_UNAVAILABLE", { error: "The AI service isn't connected yet." });

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiCharacterReplace;
    if (!config.enabled || !entitlement.allowed) return fail("FEATURE_UNAVAILABLE");
    // Part 8 §2: the switches refuse a NEW project before any upload ticket is minted; results and history stay reachable.
    if (config.ops.maintenanceMode) return fail("CR_MAINTENANCE", { error: config.ops.maintenanceMessage });
    if (!config.ops.processingEnabled) return fail("CR_BUSY");
    const modeView = modeConfig(config, mode);
    if (!modeView.enabled) return fail("FEATURE_UNAVAILABLE", { error: `${replacementModeLabel(mode)} isn't available right now.` });

    // The same rules the browser applied, applied again (§4) — sizes, types, dimensions — the MODE's own ceilings (Part 6).
    const publicConfig = publicCharacterReplaceConfig(config, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, true);
    const limits = characterReplaceLimits(publicConfig, mode);
    for (const [i, image] of [photo, ...references].entries()) {
      const photoVerdict = validatePhotoFile({ size: image.size, type: image.mimeType, name: image.name }, limits);
      if (!photoVerdict.ok) return fail(photoVerdict.code === "image-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
      const pixelsVerdict = validatePhotoPixels({ width: image.width, height: image.height }, limits);
      if (!pixelsVerdict.ok) return fail("INVALID_INPUT", { error: i === 0 ? "That photo is too small." : `Reference photo ${i + 1} is too small.` });
    }
    // Extra identity photos only where the mode takes them, and never more than the operator allows.
    if (references.length > Math.max(0, modeView.maximumReferenceImages - 1)) {
      return fail("INVALID_INPUT", { error: `${replacementModeLabel(mode)} takes up to ${modeView.maximumReferenceImages} reference photo${modeView.maximumReferenceImages === 1 ? "" : "s"}.` });
    }
    const videoVerdict = validateVideoFile({ size: video.size, type: video.mimeType, name: video.name }, limits);
    if (!videoVerdict.ok) return fail(videoVerdict.code === "file-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
    // A replacement audio file (Part 6 §3): offered by the operator, within its size ceiling, a kind we take.
    if (audio) {
      if (!config.voice.newVoiceEnabled || !config.audio.replacementEnabled) return fail("FEATURE_UNAVAILABLE", { error: "Uploading your own audio isn't available right now." });
      const audioVerdict = validateAudioFile({ name: audio.name, size: audio.size, type: audio.mimeType }, { maxBytes: config.audio.maximumUploadBytes });
      if (!audioVerdict.ok) return fail(audioVerdict.code === "audio-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
      if (audio.durationMs !== null && audio.durationMs > config.audio.maximumDurationSeconds * 1000) return fail("INVALID_INPUT", { error: `Audio can be up to ${config.audio.maximumDurationSeconds} seconds.` });
    }

    // The acceptable-use screen reads the only member text there is: the filenames.
    const policy = screenAiJob({ sourceName: `${video.name} ${photo.name} ${references.map((r) => r.name).join(" ")} ${audio?.name ?? ""}`.trim(), sourceUrl: null, sourceKind: "upload" });
    if (!policy.allowed) {
      console.info("[cr/jobs] policy block", policyBlockEvent(policy.reason, subject.key));
      return fail("POLICY_BLOCKED");
    }

    const ownerId = subjectOwnerId(subject);
    const tickets = async (jobId: string) => {
      const [videoTicket, photoTicket, ...rest] = await Promise.all([
        createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: extensionForUpload(video.name, video.mimeType), role: "source" }),
        createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: imageExtensionForUpload(photo.name, photo.mimeType), role: "character" }),
        ...references.map((r, i) =>
          createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: imageExtensionForUpload(r.name, r.mimeType), role: "reference", index: i + 2 }),
        ),
        ...(audio ? [createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: audioExtensionForUpload(audio.name, audio.mimeType), role: "voice" })] : []),
      ]);
      const referenceTickets = rest.slice(0, references.length);
      const voiceTicket = audio ? (rest[references.length] ?? null) : null;
      return { video: videoTicket, photo: photoTicket, references: referenceTickets, voice: voiceTicket };
    };

    const existing = await findJobByRequestId(subject, clientRequestId);
    if (existing) {
      const uploads = existing.status === "queued" ? await tickets(existing.id) : null;
      return NextResponse.json({ job: jobToView(existing, storedErrorMessage), created: false, uploads });
    }

    // §28: one Character Replace at a time per member — a cost ceiling as much as a queue rule.
    const active = await countActiveJobs(subject, feature.id);
    if (active >= Math.max(1, entitlement.maxConcurrent)) return fail("JOB_ALREADY_PROCESSING");

    /*
      ── §7: A RETRY IS A NEW ATTEMPT OF THE SAME PROJECT ─────────────────────
      `retryOf` must be this member's own Character Replace job (the read runs
      as the member, so somebody else's id reads as "no such job") and must be
      finished — a live job cannot be "retried" into a second charge. The old
      row is never touched: its prediction id, ledger row and error stay as
      history; the new row carries `attempt + 1` and the project's id.
    */
    let lineage: { attempt: number; projectId: string; retryOf: string } | null = null;
    if (retryOf) {
      const prior = await getOwnJob(subject, retryOf);
      if (!prior || prior.feature !== feature.id || prior.metadata?.tool !== "character_replace") return fail("INVALID_INPUT", { error: "That earlier attempt isn't yours to retry." });
      if (isActiveStatus(prior.status)) return fail("JOB_ALREADY_PROCESSING");
      const priorAttempt = typeof prior.metadata?.attempt === "number" ? prior.metadata.attempt : 1;
      lineage = { attempt: priorAttempt + 1, projectId: typeof prior.metadata?.project_id === "string" ? prior.metadata.project_id : prior.id, retryOf: prior.id };
    }

    const result = await createJob({
      subject,
      feature,
      source: { kind: "upload", size: video.size, mimeType: video.mimeType, durationSeconds: video.durationMs / 1000, name: video.name },
      clientRequestId,
    });
    const uploads = await tickets(result.row.id);
    await reserveSourcePath(result.row.id, uploads.video.path);
    /*
      The contract every later stage reads (lib/ai/character-replace/job-meta.ts).
      Settings, trim and the quote land at /start; the worker replaces the
      browser's facts with measured ones. Written with the service role,
      merged over what createJob wrote (the source name).
    */
    const { error } = await createAdminClient()
      .from("ai_jobs")
      .update({
        // Part 7 §21: the result window is the operator's (`retention.resultHours`), not the registry's constant.
        expires_at: new Date(Date.now() + config.retention.resultHours * 3_600_000).toISOString(),
        metadata: {
          ...(result.row.metadata ?? {}),
          tool: "character_replace",
          attempt: lineage?.attempt ?? 1,
          project_id: lineage?.projectId ?? result.row.id,
          retry_of: lineage?.retryOf ?? null,
          // Part 6: the mode, the extra references and the audio file the member will upload. Settings and the voice choice land at /start.
          mode,
          character: { path: uploads.photo.path, mime: photo.mimeType.toLowerCase(), size: photo.size, width: photo.width, height: photo.height, name: photo.name.slice(0, 200) },
          references: references.map((r, i) => ({ path: uploads.references[i]!.path, mime: r.mimeType.toLowerCase(), size: r.size, width: r.width, height: r.height, name: r.name.slice(0, 200) })),
          video: { path: uploads.video.path, mime: video.mimeType.toLowerCase(), size: video.size, durationMs: video.durationMs, width: video.width, height: video.height, hasAudio: video.hasAudio },
          audio:
            audio && uploads.voice
              ? { source: "upload", upload: { path: uploads.voice.path, mime: audio.mimeType.toLowerCase(), size: audio.size, durationMs: audio.durationMs, name: audio.name.slice(0, 200) }, tts: null, trimToFit: false, voiceConsent: false, prepared: null }
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
      .eq("status", "queued");
    if (error) {
      console.error("[cr/jobs] metadata write failed", { jobId: result.row.id, message: error.message });
      return fail("INTERNAL_ERROR");
    }

    console.info("[cr/jobs] opened", { jobId: result.row.id, userId: ownerId, feature: feature.id, mode, references: references.length, audio: !!audio, created: result.created, audience: entitlement.audience, attempt: lineage?.attempt ?? 1, retryOf: lineage?.retryOf ?? null });
    return NextResponse.json({ job: jobToView(result.row, storedErrorMessage), created: result.created, uploads }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/jobs] create failed", { subject: subject.key, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/jobs] create threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
