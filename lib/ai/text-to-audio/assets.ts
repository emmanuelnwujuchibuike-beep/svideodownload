import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { deleteAiJobResult } from "@/lib/ai/retention";
import { AI_RESULT_BUCKET, AI_SIGNED_URL_TTL_SECONDS, pathBelongsTo } from "@/lib/ai/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AUDIO LIBRARY (migration 0170: ai_audio_assets)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The brief (§6): "name · duration · voice/model used · creation date ·
 * character count · play · download · delete · Use in Lip Sync Pro". One row
 * per saved generation, pointing at the MP3 the finalizer put in the RESULTS
 * bucket under the job's own folder — so `pathBelongsTo` proves ownership of
 * the object the same way it does for a video, and the retention sweep can
 * delete by path.
 *
 * Every read is scoped by `user_id` (the service role reads; RLS is the
 * second wall). Delete is SOFT on the row (the ledger keeps its history) and
 * HARD on the object; the job it came from is marked `deleted` too, so the
 * history tile and the library agree.
 */
export interface AudioAssetRow {
  id: string;
  user_id: string;
  job_id: string | null;
  name: string;
  path: string;
  mime: string;
  bytes: number;
  duration_ms: number | null;
  provider: string | null;
  model: string | null;
  voice_id: string | null;
  language_code: string | null;
  characters: number;
  created_at: string;
  deleted_at: string | null;
}

const COLUMNS = "id, user_id, job_id, name, path, mime, bytes, duration_ms, provider, model, voice_id, language_code, characters, created_at, deleted_at";

/** What a member sees of an asset — never the path, the provider or the model id. */
export interface AudioAssetView {
  id: string;
  jobId: string | null;
  name: string;
  mime: string;
  bytes: number;
  durationMs: number | null;
  /** The catalogue voice id (the interface labels it); null for the provider's default voice. */
  voiceId: string | null;
  languageCode: string | null;
  characters: number;
  createdAt: string;
}

export function audioAssetToView(a: AudioAssetRow): AudioAssetView {
  return { id: a.id, jobId: a.job_id, name: a.name, mime: a.mime, bytes: a.bytes, durationMs: a.duration_ms, voiceId: a.voice_id, languageCode: a.language_code, characters: a.characters, createdAt: a.created_at };
}

export async function listAudioAssets(userId: string, limit = 100): Promise<AudioAssetRow[]> {
  const { data, error } = await createAdminClient().from("ai_audio_assets").select(COLUMNS).eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data ?? []) as AudioAssetRow[];
}

export async function getAudioAsset(userId: string, id: string): Promise<AudioAssetRow | null> {
  const { data, error } = await createAdminClient().from("ai_audio_assets").select(COLUMNS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data as AudioAssetRow | null) ?? null;
}

export async function getAudioAssetByJob(userId: string, jobId: string): Promise<AudioAssetRow | null> {
  const { data, error } = await createAdminClient().from("ai_audio_assets").select(COLUMNS).eq("user_id", userId).eq("job_id", jobId).is("deleted_at", null).maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data as AudioAssetRow | null) ?? null;
}

/**
 * Save a finished generation. Idempotent per job (unique index on job_id):
 * a second finalize of the same job finds the first row and returns it.
 */
export async function createAudioAsset(input: { userId: string; jobId: string; name: string; path: string; mime: string; bytes: number; durationMs: number | null; provider: string; model: string; voiceId: string | null; languageCode: string | null; characters: number }): Promise<AudioAssetRow> {
  if (!pathBelongsTo(input.path, input.userId, input.jobId)) throw new AiJobError("INTERNAL_ERROR", "asset path failed ownership");
  const db = createAdminClient();
  const { data, error } = await db
    .from("ai_audio_assets")
    .insert({ user_id: input.userId, job_id: input.jobId, name: input.name.slice(0, 120), path: input.path, mime: input.mime, bytes: input.bytes, duration_ms: input.durationMs, provider: input.provider, model: input.model, voice_id: input.voiceId, language_code: input.languageCode, characters: input.characters })
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const existing = await getAudioAssetByJob(input.userId, input.jobId);
      if (existing) return existing;
    }
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return data as AudioAssetRow;
}

export async function renameAudioAsset(userId: string, id: string, name: string): Promise<AudioAssetRow | null> {
  const { data, error } = await createAdminClient().from("ai_audio_assets").update({ name: name.slice(0, 120) }).eq("user_id", userId).eq("id", id).is("deleted_at", null).select(COLUMNS).maybeSingle();
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  return (data as AudioAssetRow | null) ?? null;
}

/** Soft-delete the row, remove the object, mark the job deleted. Idempotent. */
export async function deleteAudioAsset(userId: string, id: string): Promise<boolean> {
  const asset = await getAudioAsset(userId, id);
  if (!asset) return false;
  const db = createAdminClient();
  const { error } = await db.from("ai_audio_assets").update({ deleted_at: new Date().toISOString() }).eq("id", asset.id).eq("user_id", userId).is("deleted_at", null);
  if (error) throw new AiJobError("INTERNAL_ERROR", error.message);
  // the job's own delete removes the object and marks the row (lib/ai/retention.ts) — the history tile and the library agree
  const job = asset.job_id ? await getJobAsService(asset.job_id) : null;
  if (job && job.user_id === userId) {
    const outcome = await deleteAiJobResult(job);
    await recordJobEvent(job.id, "result.deleted", { from: "audio-library", assetId: asset.id, objectsDeleted: outcome.objectsDeleted, errors: outcome.errors }, `member:${userId}`).catch(() => null);
  } else if (asset.job_id && pathBelongsTo(asset.path, userId, asset.job_id)) {
    await db.storage.from(AI_RESULT_BUCKET).remove([asset.path]).catch(() => null);
  }
  return true;
}

/** A short-lived signed URL for playback, or a download with the member's name on the file. */
export async function signAudioAssetUrl(asset: AudioAssetRow, download?: boolean): Promise<{ url: string; expiresIn: number }> {
  const ext = asset.mime === "audio/wav" || asset.mime === "audio/x-wav" ? "wav" : asset.mime === "audio/mp4" ? "m4a" : "mp3";
  const fileName = `${asset.name.replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "frenz-ai-audio"}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(AI_RESULT_BUCKET).createSignedUrl(asset.path, AI_SIGNED_URL_TTL_SECONDS, download ? { download: fileName } : undefined);
  if (error || !data?.signedUrl) throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed url");
  return { url: data.signedUrl, expiresIn: AI_SIGNED_URL_TTL_SECONDS };
}

/** Bring an asset's bytes back (Lip Sync Pro copies a library file into its job's folder). Bounded. */
export async function readAudioAssetBytes(asset: AudioAssetRow, maxBytes: number): Promise<Buffer> {
  if (asset.bytes > maxBytes) throw new AiJobError("FILE_TOO_LARGE", `asset is ${asset.bytes} bytes`);
  const { data, error } = await createAdminClient().storage.from(AI_RESULT_BUCKET).download(asset.path);
  if (error || !data) throw new AiJobError("STORAGE_ERROR", error?.message ?? "asset download failed");
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new AiJobError("FILE_TOO_LARGE", `asset is ${buf.byteLength} bytes`);
  return buf;
}
