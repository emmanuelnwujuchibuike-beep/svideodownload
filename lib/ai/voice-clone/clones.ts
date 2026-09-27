import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { AI_SIGNED_URL_TTL_SECONDS, AI_SOURCE_BUCKET, pathBelongsTo, pathBelongsToOwner } from "@/lib/ai/storage";
import type { VoiceCloneConfig } from "@/lib/ai/voice-clone/config";
import { voiceCloneProviderFor } from "@/lib/ai/voice-clone/provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VOICE LIBRARY (migration 0171: ai_voice_clones)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A member's own voices: name, when it was made, how much audio it was built
 * from, play the sample, rename, delete — and use it in Text to Audio and Lip
 * Sync Pro. One row per voice.
 *
 * Every read is scoped by `user_id` (the service role reads; RLS is the second
 * wall). `provider_voice_id` never leaves this module's callers on the server:
 * a member's browser sees OUR id, and the server maps it when it speaks.
 *
 * ── 🔴 THE SLOT ACCOUNTING IS THE POINT OF THIS FILE ────────────────────────
 * `countLiveClones` and `countLiveClonesForAccount` are read at Start, before
 * any money moves, because a clone that cannot be stored is a charge for
 * nothing — and because voice slots are shared by every member, so one member
 * filling them is everybody's problem. Delete removes the provider's voice
 * FIRST: a soft-deleted row with a live voice behind it is a slot nobody can
 * ever reclaim.
 */
export type VoiceCloneStatus = "pending" | "ready" | "failed" | "deleted";

export interface VoiceCloneRow {
  id: string;
  user_id: string;
  job_id: string | null;
  name: string;
  description: string;
  provider: string;
  provider_voice_id: string;
  status: VoiceCloneStatus;
  sample_count: number;
  sample_bytes: number;
  sample_seconds: number | null;
  preview_path: string | null;
  preview_mime: string | null;
  language_code: string | null;
  labels: Record<string, unknown>;
  consent_at: string;
  consent_name: string;
  consent_statement: string;
  created_at: string;
  ready_at: string | null;
  last_used_at: string | null;
  deleted_at: string | null;
}

const COLUMNS =
  "id, user_id, job_id, name, description, provider, provider_voice_id, status, sample_count, sample_bytes, sample_seconds, preview_path, preview_mime, language_code, labels, consent_at, consent_name, consent_statement, created_at, ready_at, last_used_at, deleted_at";

/** What a member sees. Never the path, the vendor, the vendor's voice id, or the consent statement's storage shape. */
export interface VoiceCloneView {
  id: string;
  jobId: string | null;
  name: string;
  description: string;
  status: VoiceCloneStatus;
  sampleCount: number;
  sampleSeconds: number | null;
  /** Whether there is a sample to play back. */
  hasPreview: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  consentAt: string;
}

export function voiceCloneToView(c: VoiceCloneRow): VoiceCloneView {
  return {
    id: c.id,
    jobId: c.job_id,
    name: c.name,
    description: c.description,
    status: c.status,
    sampleCount: c.sample_count,
    sampleSeconds: c.sample_seconds,
    hasPreview: !!c.preview_path,
    createdAt: c.created_at,
    lastUsedAt: c.last_used_at,
    consentAt: c.consent_at,
  };
}

export async function listVoiceClones(userId: string, limit = 50): Promise<VoiceCloneRow[]> {
  const { data, error } = await createAdminClient().from("ai_voice_clones").select(COLUMNS).eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(Math.min(200, Math.max(1, limit)));
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data ?? []) as VoiceCloneRow[];
}

/** The voices this member may SPEAK with — ready ones only. Read by Text to Audio and Lip Sync Pro. */
export async function listUsableVoiceClones(userId: string): Promise<VoiceCloneRow[]> {
  const { data, error } = await createAdminClient().from("ai_voice_clones").select(COLUMNS).eq("user_id", userId).eq("status", "ready").is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
  if (error) {
    // 0171 not applied yet, or the table unreachable: a member is offered no clones rather than an error on a tool that works without them
    console.error("[vc/clones] usable list failed", { userId, message: error.message });
    return [];
  }
  return (data ?? []) as VoiceCloneRow[];
}

export async function getVoiceClone(userId: string, id: string): Promise<VoiceCloneRow | null> {
  const { data, error } = await createAdminClient().from("ai_voice_clones").select(COLUMNS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data as VoiceCloneRow | null) ?? null;
}

export async function getVoiceCloneByJob(userId: string, jobId: string): Promise<VoiceCloneRow | null> {
  const { data, error } = await createAdminClient().from("ai_voice_clones").select(COLUMNS).eq("user_id", userId).eq("job_id", jobId).is("deleted_at", null).maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data as VoiceCloneRow | null) ?? null;
}

/** How many live voices this member holds — their slot count, read before anything is charged. */
export async function countLiveClones(userId: string): Promise<number> {
  const { count, error } = await createAdminClient().from("ai_voice_clones").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["pending", "ready"]).is("deleted_at", null);
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return count ?? 0;
}

/** How many live voices EVERY member holds together — the provider account's own ceiling. */
export async function countLiveClonesForAccount(): Promise<number> {
  const { count, error } = await createAdminClient().from("ai_voice_clones").select("id", { count: "exact", head: true }).in("status", ["pending", "ready"]).is("deleted_at", null);
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return count ?? 0;
}

/**
 * Record a voice the provider just made. Idempotent per job (the unique index
 * on `job_id`): a second run of the same job finds the first row and answers
 * it, rather than creating a second row pointing at the same provider voice.
 */
export async function createVoiceClone(input: {
  userId: string;
  jobId: string;
  name: string;
  description: string;
  provider: string;
  providerVoiceId: string;
  sampleCount: number;
  sampleBytes: number;
  sampleSeconds: number | null;
  previewPath: string | null;
  previewMime: string | null;
  languageCode: string | null;
  labels: Record<string, unknown>;
  consent: { at: string; name: string; statement: string };
}): Promise<VoiceCloneRow> {
  if (input.previewPath && !pathBelongsTo(input.previewPath, input.userId, input.jobId)) throw new AiJobError("INTERNAL_ERROR", "clone preview path failed ownership");
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("ai_voice_clones")
    .insert({
      user_id: input.userId,
      job_id: input.jobId,
      name: input.name.slice(0, 60),
      description: input.description.slice(0, 300),
      provider: input.provider,
      provider_voice_id: input.providerVoiceId,
      status: "ready",
      sample_count: input.sampleCount,
      sample_bytes: input.sampleBytes,
      sample_seconds: input.sampleSeconds,
      preview_path: input.previewPath,
      preview_mime: input.previewMime,
      language_code: input.languageCode,
      labels: input.labels,
      consent_at: input.consent.at,
      consent_name: input.consent.name,
      consent_statement: input.consent.statement,
      ready_at: now,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const existing = await getVoiceCloneByJob(input.userId, input.jobId);
      if (existing) return existing;
    }
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return data as VoiceCloneRow;
}

export async function renameVoiceClone(userId: string, id: string, name: string, description: string | undefined, config: VoiceCloneConfig): Promise<VoiceCloneRow | null> {
  const before = await getVoiceClone(userId, id);
  if (!before) return null;
  const { data, error } = await createAdminClient()
    .from("ai_voice_clones")
    .update({ name: name.slice(0, 60), ...(description === undefined ? {} : { description: description.slice(0, 300) }) })
    .eq("user_id", userId)
    .eq("id", id)
    .is("deleted_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  const row = (data as VoiceCloneRow | null) ?? null;
  // best-effort at the provider, so whoever looks after the account sees the same names
  if (row) await voiceCloneProviderFor(config).rename({ providerVoiceId: row.provider_voice_id, name: row.name, description: row.description });
  return row;
}

/**
 * Delete a voice: the PROVIDER first (that is what frees the slot), then our
 * row, then the samples.
 *
 * 🔴 The order is the whole correctness of this function. If our row went
 * first and the provider call then failed, the voice would keep its slot for
 * ever with nothing left in our database pointing at it — unreachable by the
 * member, invisible to the operator, and still counted by the vendor. So a
 * provider failure ABORTS the delete and the member is told to try again; only
 * `alreadyGone` lets it continue, because that is the state we wanted.
 */
export async function deleteVoiceClone(userId: string, id: string, config: VoiceCloneConfig, actor: "member" | "admin" = "member"): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const clone = await getVoiceClone(userId, id);
  if (!clone) return { deleted: false, alreadyGone: false };
  const outcome = await voiceCloneProviderFor(config).remove(clone.provider_voice_id);
  const db = createAdminClient();
  const { error } = await db.from("ai_voice_clones").update({ status: "deleted", deleted_at: new Date().toISOString() }).eq("id", clone.id).eq("user_id", userId).is("deleted_at", null);
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  /*
    The member's own recordings go with the voice — they were only ever here to
    make it.

    🔴 `pathBelongsToOwner`, not `pathBelongsTo`. A voice outlives its job and
    `job_id` is `on delete set null`, so an older voice has an owner but no job
    id — and the job-scoped check answers false for it, which silently skipped
    the removal and left somebody's recordings in the bucket after we told them
    they were deleted.
  */
  if (clone.preview_path && (clone.job_id ? pathBelongsTo(clone.preview_path, userId, clone.job_id) : pathBelongsToOwner(clone.preview_path, userId))) {
    const folder = clone.preview_path.slice(0, clone.preview_path.lastIndexOf("/"));
    const { data: listed } = await db.storage.from(AI_SOURCE_BUCKET).list(folder, { limit: 100 });
    const paths = (listed ?? []).map((f) => `${folder}/${f.name}`);
    if (paths.length > 0) await db.storage.from(AI_SOURCE_BUCKET).remove(paths).catch(() => null);
  }
  if (clone.job_id) {
    const job = await getJobAsService(clone.job_id).catch(() => null);
    if (job) await recordJobEvent(job.id, "result.deleted", { from: "voice-library", cloneId: clone.id, alreadyGone: outcome.alreadyGone }, `${actor}:${userId}`).catch(() => null);
  }
  console.info("[vc/clones] deleted", { userId, cloneId: clone.id, alreadyGone: outcome.alreadyGone, actor });
  return { deleted: true, alreadyGone: outcome.alreadyGone };
}

/** A short-lived signed URL for the member's own sample — what "hear what you gave us" plays. */
export async function signVoiceCloneSampleUrl(clone: VoiceCloneRow): Promise<{ url: string; expiresIn: number; mime: string }> {
  if (!clone.preview_path) throw new AiJobError("JOB_NOT_FOUND", "this voice has no stored sample");
  const { data, error } = await createAdminClient().storage.from(AI_SOURCE_BUCKET).createSignedUrl(clone.preview_path, AI_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed url");
  return { url: data.signedUrl, expiresIn: AI_SIGNED_URL_TTL_SECONDS, mime: clone.preview_mime ?? "audio/mpeg" };
}

/**
 * Note that a voice was spoken with. Best-effort and fire-and-forget: it feeds
 * "last used" in the library and the operator's view of which slots are dead
 * weight, and it must never be able to fail a generation.
 */
export async function touchVoiceClone(id: string): Promise<void> {
  await createAdminClient()
    .from("ai_voice_clones")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
    .then(({ error }) => error && console.warn("[vc/clones] touch failed", { id, message: error.message }));
}

/**
 * Resolve a clone id the BROWSER sent into the provider's voice id.
 *
 * 🔴 The gate between "a member picked their own voice" and "a member typed a
 * provider voice id". The lookup is scoped by `user_id` and by `status`, so
 * somebody else's clone — and a member's own half-made one — answer as no
 * voice at all. This is the only way a clone can reach a provider call.
 */
export async function resolveOwnClone(userId: string, cloneId: string): Promise<VoiceCloneRow | null> {
  const { data, error } = await createAdminClient().from("ai_voice_clones").select(COLUMNS).eq("user_id", userId).eq("id", cloneId).eq("status", "ready").is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[vc/clones] resolve failed", { userId, cloneId, message: error.message });
    return null;
  }
  return (data as VoiceCloneRow | null) ?? null;
}
