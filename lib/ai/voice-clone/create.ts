import "server-only";

import { policyBlockEvent, screenAiText } from "@/lib/ai/acceptable-use";
import type { AiEntitlement } from "@/lib/ai/entitlement";
import type { AiErrorCode } from "@/lib/ai/errors";
import { aiFeature, type AiFeatureDef, type AiJobRow } from "@/lib/ai/jobs";
import { createJob, getOwnJob, reserveSourcePath } from "@/lib/ai/job-store";
import { audioExtensionForUpload } from "@/lib/ai/media";
import { createSourceUploadTicket, type UploadTicket } from "@/lib/ai/storage-server";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { voiceCloneFormatAllowed, voiceCloneSlotsFor, type VoiceCloneConfig } from "@/lib/ai/voice-clone/config";
import { countLiveClones, countLiveClonesForAccount } from "@/lib/ai/voice-clone/clones";
import { defaultVoiceName } from "@/lib/ai/voice-clone/job-meta";
import { normalizeVoiceCloneLabels } from "@/lib/ai/voice-clone/labels";
import { resolveVoiceCloneProvider } from "@/lib/ai/voice-clone/provider";
import type { CreateVoiceCloneJobRequest } from "@/lib/ai/voice-clone/schemas";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/wallet/server";
import type { LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OPEN A VOICE CLONE — the gate, the checks, the draft, the upload tickets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two steps, for one reason: the samples are FILES. The browser PUTs them
 * straight into our private bucket with signed tickets minted here, so the
 * bytes never pass through a serverless function — the same rule every other
 * upload in this project follows, and the difference between a member's five
 * recordings costing us nothing and costing us a function holding forty
 * megabytes of memory.
 *
 *   1  create   this file: nothing charged, nothing consented to, nothing
 *               sent. A `queued` draft with the samples named, and one
 *               ticket per sample. The draft sweep expires it if the member
 *               walks away.
 *   2  start    lib/ai/voice-clone/start.ts: the consent, the price, the
 *               funding, then the provider.
 *
 * ── 🔴 THE SLOTS ARE CHECKED HERE TOO, BEFORE AN UPLOAD ─────────────────────
 * Start checks them again, authoritatively, because they can fill in between.
 * This check exists so a member whose slots are already full is told so BEFORE
 * they upload forty megabytes of audio, rather than after.
 */
export interface VoiceCloneCreateContext {
  subject: AiSubject & { kind: "user" };
  feature: AiFeatureDef;
  settings: LandingSettings;
  entitlement: AiEntitlement;
  config: VoiceCloneConfig;
  isAdmin: boolean;
}
export type VoiceCloneRefusal = { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };
export interface VoiceCloneDraft {
  row: AiJobRow;
  created: boolean;
  /** One per sample, in the order the member listed them. `index` is the object's position in the job folder. */
  uploads: { index: number; path: string; uploadUrl: string; expiresIn: number }[];
}

const refuse = (code: AiErrorCode, extra?: Record<string, unknown>): VoiceCloneRefusal => ({ ok: false, code, extra });

/** The switches, in the order every paid AI tool checks them. */
export async function voiceCloneGate(ctx: Pick<VoiceCloneCreateContext, "settings" | "entitlement" | "config">, subject: AiSubject): Promise<VoiceCloneRefusal | { ok: true }> {
  const { settings, entitlement, config } = ctx;
  const cr = settings.frenzAiCharacterReplace;
  if (!config.enabled || !entitlement.allowed) return refuse("FEATURE_UNAVAILABLE");
  // the Character Replace kill switches govern every paid AI tool (launch mode, maintenance, processing pause)
  if (!(await launchAllows(cr, subject))) return refuse("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });
  if (cr.ops.maintenanceMode) return refuse("CR_MAINTENANCE", { error: cr.ops.maintenanceMessage });
  if (!cr.ops.processingEnabled) return refuse("CR_BUSY");
  const resolved = resolveVoiceCloneProvider(config);
  if (!resolved.enabled || !resolved.configured) {
    console.warn("[vc/create] refused — provider", { subject: subject.key, reason: resolved.diagnostic });
    return refuse("PROVIDER_UNAVAILABLE", { error: "Voice Cloning is temporarily unavailable. Try again in a few minutes — nothing has been charged." });
  }
  return { ok: true };
}

/**
 * Whether there is room for one more voice. The ACCOUNT's ceiling is checked
 * first on purpose: when the platform is full, telling a member to "delete one
 * of yours" would be advice that does not help them.
 */
export async function voiceCloneCapacity(ctx: Pick<VoiceCloneCreateContext, "config" | "entitlement" | "isAdmin">, userId: string): Promise<VoiceCloneRefusal | { ok: true; used: number; slots: number }> {
  const { config, entitlement, isAdmin } = ctx;
  const slots = voiceCloneSlotsFor(config, { audience: entitlement.audience, isAdmin });
  if (slots <= 0) return refuse("FEATURE_UNAVAILABLE", { error: "Voice Cloning isn't part of your plan yet." });
  if (config.accountVoiceCap > 0) {
    const account = await countLiveClonesForAccount();
    if (account >= config.accountVoiceCap) {
      console.error("[vc/create] the account's voice slots are full", { account, cap: config.accountVoiceCap });
      return refuse("VOICE_CLONE_CAPACITY");
    }
  }
  const used = await countLiveClones(userId);
  if (used >= slots) return refuse("VOICE_CLONE_LIMIT", { slots, used });
  return { ok: true, used, slots };
}

/** The browser's facts, checked against the operator's ceilings. The real objects are measured at Start. */
export function validateVoiceCloneSamples(config: VoiceCloneConfig, samples: CreateVoiceCloneJobRequest["samples"]): VoiceCloneRefusal | null {
  if (samples.length < config.samples.minimum) return refuse("INVALID_INPUT", { error: `Add at least ${config.samples.minimum} recording${config.samples.minimum === 1 ? "" : "s"}.` });
  if (samples.length > config.samples.maximum) return refuse("INVALID_INPUT", { error: `Up to ${config.samples.maximum} recordings.` });
  let total = 0;
  let seconds = 0;
  for (const s of samples) {
    if (!voiceCloneFormatAllowed(config, s)) return refuse("UNSUPPORTED_FORMAT", { error: `Recordings can be ${config.samples.formats.map((f) => f.toUpperCase()).join(", ")}.` });
    if (s.size <= 0) return refuse("INVALID_INPUT", { error: "One of those files is empty." });
    if (s.size > config.samples.maximumBytes) return refuse("FILE_TOO_LARGE", { error: "One of those recordings is too large." });
    if (s.durationMs != null && s.durationMs > config.samples.maximumSecondsEach * 1000) return refuse("INVALID_INPUT", { error: `Each recording can be up to ${config.samples.maximumSecondsEach} seconds.`, limit: "too_long" });
    total += s.size;
    seconds += (s.durationMs ?? 0) / 1000;
  }
  if (total > config.samples.maximumTotalBytes) return refuse("FILE_TOO_LARGE", { error: "Those recordings are too much audio together. Remove one and try again." });
  /*
    The browser measured these, so this is a HELP rather than a guard — but it
    is the check that saves a member from paying for a clone the provider will
    refuse for having too little to learn from. A file whose duration could not
    be read (0) is not counted against them.
  */
  if (seconds > 0 && seconds < config.samples.minimumSecondsTotal) {
    return refuse("INVALID_INPUT", { error: `Add at least ${config.samples.minimumSecondsTotal} seconds of speech in total — more audio makes a noticeably better voice.`, limit: "too_short" });
  }
  return null;
}

/** The acceptable-use screen reads what the member typed and the filenames they chose. */
export function screenVoiceClone(subjectKey: string, name: string, description: string, samples: CreateVoiceCloneJobRequest["samples"]): VoiceCloneRefusal | null {
  const policy = screenAiText(name, `${description} ${samples.map((s) => s.name).join(" ")}`.trim());
  if (!policy.allowed) {
    console.info("[vc/create] policy block", policyBlockEvent(policy.reason, subjectKey));
    return refuse("POLICY_BLOCKED");
  }
  return null;
}

export async function mintVoiceCloneTickets(ownerId: string, feature: AiFeatureDef, jobId: string, samples: CreateVoiceCloneJobRequest["samples"]): Promise<UploadTicket[]> {
  return Promise.all(
    samples.map((s, i) =>
      createSourceUploadTicket({ userId: ownerId, feature: feature.id, jobId, extension: audioExtensionForUpload(s.name, s.mimeType), role: "voice_sample", index: i + 1 }),
    ),
  );
}

/**
 * Open the draft. Idempotent on `clientRequestId`: a retry of the same request
 * finds the same row and gets fresh tickets for it, which is what a half-failed
 * upload needs (the tickets may overwrite the member's own objects in their own
 * job folder — see the note on `createSourceUploadTicket`).
 */
export async function createVoiceCloneJob(ctx: VoiceCloneCreateContext, body: CreateVoiceCloneJobRequest): Promise<VoiceCloneDraft | VoiceCloneRefusal> {
  const { subject, feature, config, settings } = ctx;
  const ownerId = subjectOwnerId(subject);
  const name = (body.name || defaultVoiceName()).slice(0, 60);
  const description = (body.description ?? "").slice(0, 300);

  const gate = await voiceCloneGate(ctx, subject);
  if (!gate.ok) return gate;
  const capacity = await voiceCloneCapacity(ctx, ownerId);
  if (!capacity.ok) return capacity;
  const invalid = validateVoiceCloneSamples(config, body.samples);
  if (invalid) return invalid;
  const blocked = screenVoiceClone(subject.key, name, description, body.samples);
  if (blocked) return blocked;

  const total = body.samples.reduce((a, s) => a + s.size, 0);
  const created = await createJob({
    subject,
    feature,
    // the "source" of this job is the audio it was built from — the first sample stands for it on the row's own columns
    source: { kind: "upload", size: total, mimeType: body.samples[0]!.mimeType, name: body.samples[0]!.name },
    clientRequestId: body.clientRequestId,
  });
  if (!created.created) {
    // an existing draft may be uploaded into again; anything further along is not a draft any more
    if (created.row.status !== "queued") return refuse("JOB_ALREADY_PROCESSING", { jobId: created.row.id });
    const tickets = await mintVoiceCloneTickets(ownerId, feature, created.row.id, body.samples);
    return { row: created.row, created: false, uploads: tickets.map((t, i) => ({ index: i + 1, path: t.path, uploadUrl: t.uploadUrl, expiresIn: t.expiresIn })) };
  }

  const tickets = await mintVoiceCloneTickets(ownerId, feature, created.row.id, body.samples);
  /*
    ── 🔴 THE RECORDINGS MUST BE SWEEPABLE (2026-09-27) ──────────────────────
    The retention sweep finds a job's objects from `source_path`'s own prefix
    (lib/ai/retention.ts `removeJobFolder`). A voice-clone job has no single
    "source", so without this line `source_path` would stay NULL and the sweep
    would never look in the folder — leaving a member's VOICE RECORDINGS in the
    bucket for ever every time somebody uploaded audio and then walked away.
    The first sample stands for the job, exactly as the video does elsewhere,
    and the whole folder goes with it.
  */
  await reserveSourcePath(created.row.id, tickets[0]!.path);
  const { data, error } = await createAdminClient()
    .from("ai_jobs")
    .update({
      /*
        When the operator set a recording retention, the JOB expires on that
        clock and the sweep takes the recordings with it. With 0 ("as long as
        the voice lives") the job keeps the feature's long default and the
        recordings are removed by the voice's own delete instead.
      */
      expires_at: new Date(Date.now() + (config.sampleRetentionDays > 0 ? config.sampleRetentionDays * 86_400_000 : feature.retentionHours * 3_600_000)).toISOString(),
      metadata: {
        ...(created.row.metadata ?? {}),
        tool: "voice_clone",
        // the brief's tool ids: one per OPERATION, so billing and analytics can group without re-deriving it
        tool_id: "voice_clone",
        name,
        description,
        // checked against the offered lists; anything else is dropped rather than sent to the vendor
        labels: normalizeVoiceCloneLabels(body.labels),
        samples: body.samples.map((s, i) => ({ path: tickets[i]!.path, mime: s.mimeType.toLowerCase(), size: s.size, durationMs: s.durationMs ?? null, name: s.name.slice(0, 200), ...(s.fromVideo ? { fromVideo: true } : {}) })),
        quote: null,
        billing: null,
        free_clones: null,
        consent: null,
        clone_id: null,
        provider: { id: "elevenlabs", model: config.model },
        audience: ctx.isAdmin ? "admin" : ctx.entitlement.audience,
        providersVersion: settings.frenzAiProviders.version,
      },
    })
    .eq("id", created.row.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[vc/create] metadata write failed", { jobId: created.row.id, message: error?.message ?? "no row" });
    return refuse("INTERNAL_ERROR");
  }
  const row = (await getOwnJob(subject, created.row.id)) ?? created.row;
  console.info("[vc/create] draft opened", { jobId: row.id, userId: ownerId, samples: body.samples.length, bytes: total, slotsUsed: capacity.used, slots: capacity.slots });
  return { row, created: true, uploads: tickets.map((t, i) => ({ index: i + 1, path: t.path, uploadUrl: t.uploadUrl, expiresIn: t.expiresIn })) };
}

/** The feature definition, or null on a build where it is not registered. */
export function voiceCloneFeature(): AiFeatureDef | null {
  return aiFeature("ai_voice_clone");
}
