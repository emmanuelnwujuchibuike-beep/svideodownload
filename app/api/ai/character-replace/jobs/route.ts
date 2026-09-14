import { NextResponse } from "next/server";

import { policyBlockEvent, screenAiJob } from "@/lib/ai/acceptable-use";
import { publicCharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { createCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";
import { characterReplaceLimits, validatePhotoFile, validatePhotoPixels, validateVideoFile } from "@/lib/ai/character-replace/validate";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { countActiveJobs, createJob, findJobByRequestId, reserveSourcePath } from "@/lib/ai/job-store";
import { extensionForUpload, imageExtensionForUpload } from "@/lib/ai/media";
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
  const { clientRequestId, photo, video } = parsed.data;
  if (!isValidClientRequestId(clientRequestId)) return fail("INVALID_INPUT");

  // The provider AND the worker: a job that could not be prepared or submitted is not opened.
  if (!hasProviderFor(feature) || !hasWorker) return fail("FEATURE_UNAVAILABLE", { error: "The AI service isn't connected yet." });

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiCharacterReplace;
    if (!config.enabled || !entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    // The same rules the browser applied, applied again (§4) — sizes, types, dimensions.
    const limits = characterReplaceLimits(publicCharacterReplaceConfig(config, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, true));
    const photoVerdict = validatePhotoFile({ size: photo.size, type: photo.mimeType, name: photo.name }, limits);
    if (!photoVerdict.ok) return fail(photoVerdict.code === "image-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");
    const pixelsVerdict = validatePhotoPixels({ width: photo.width, height: photo.height }, limits);
    if (!pixelsVerdict.ok) return fail("INVALID_INPUT", { error: "That photo is too small." });
    const videoVerdict = validateVideoFile({ size: video.size, type: video.mimeType, name: video.name }, limits);
    if (!videoVerdict.ok) return fail(videoVerdict.code === "file-too-large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FORMAT");

    // The acceptable-use screen reads the only member text there is: the filenames.
    const policy = screenAiJob({ sourceName: `${video.name} ${photo.name}`, sourceUrl: null, sourceKind: "upload" });
    if (!policy.allowed) {
      console.info("[cr/jobs] policy block", policyBlockEvent(policy.reason, subject.key));
      return fail("POLICY_BLOCKED");
    }

    const ownerId = subjectOwnerId(subject);
    const tickets = async (jobId: string) => {
      const [videoTicket, photoTicket] = await Promise.all([
        createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: extensionForUpload(video.name, video.mimeType), role: "source" }),
        createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: imageExtensionForUpload(photo.name, photo.mimeType), role: "character" }),
      ]);
      return { video: videoTicket, photo: photoTicket };
    };

    const existing = await findJobByRequestId(subject, clientRequestId);
    if (existing) {
      const uploads = existing.status === "queued" ? await tickets(existing.id) : null;
      return NextResponse.json({ job: jobToView(existing, storedErrorMessage), created: false, uploads });
    }

    // §28: one Character Replace at a time per member — a cost ceiling as much as a queue rule.
    const active = await countActiveJobs(subject, feature.id);
    if (active >= Math.max(1, entitlement.maxConcurrent)) return fail("JOB_ALREADY_PROCESSING");

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
        metadata: {
          ...(result.row.metadata ?? {}),
          tool: "character_replace",
          attempt: 1,
          character: { path: uploads.photo.path, mime: photo.mimeType.toLowerCase(), size: photo.size, width: photo.width, height: photo.height, name: photo.name.slice(0, 200) },
          video: { path: uploads.video.path, mime: video.mimeType.toLowerCase(), size: video.size, durationMs: video.durationMs, width: video.width, height: video.height, hasAudio: video.hasAudio },
          trim: null,
          settings: { quality: publicCharacterReplaceConfig(config, { code: settings.frenzAiCurrency, symbol: "" }, true).defaultQuality, voiceMode: "original", lipSyncMode: null },
          quote: null,
          prepared: null,
          provider: null,
        },
      })
      .eq("id", result.row.id)
      .eq("status", "queued");
    if (error) {
      console.error("[cr/jobs] metadata write failed", { jobId: result.row.id, message: error.message });
      return fail("INTERNAL_ERROR");
    }

    console.info("[cr/jobs] opened", { jobId: result.row.id, userId: ownerId, feature: feature.id, created: result.created, audience: entitlement.audience });
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
