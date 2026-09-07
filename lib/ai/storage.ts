import type { AiFeature } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — where the files will live, and why not in the existing bucket
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2): prepare private storage; reuse an existing
 * private bucket if there is one.
 *
 * ── There is not one, and that is the finding ────────────────────────────────
 *
 * Everything this product stores today is meant to be fetched by anyone with
 * the link: R2 behind a public CDN domain, with the Supabase `post-media`
 * bucket as a public fallback (lib/storage/index.ts). That is exactly right for
 * a post someone published, and exactly wrong for a video they have not.
 *
 * An AI Clean input is unpublished footage. It may be a private family clip
 * with a name burned into it. Putting it anywhere whose URL is a permanent
 * public read would make "we processed your video" mean "we published your
 * video", and no amount of URL obscurity fixes that — an unguessable public
 * object is still one paste away from being a public object.
 *
 * So: two buckets of their own, both private, created in migration 0141 with no
 * RLS policy on `storage.objects` at all. A member cannot list, read or write
 * them with their own key. Access is one short-lived signed URL per file, minted
 * by a route that has already checked the job belongs to the caller.
 *
 * ── 🔴 Nothing writes to these yet ───────────────────────────────────────────
 *
 * Part 2 stores no files. `ai_jobs.source_path` and `.result_path` are NULL on
 * every row this release creates. What this module provides is the shape those
 * paths will take and the check that proves one belongs to the job that claims
 * it — written now, while the rules are being decided, rather than improvised
 * in the part that is busy talking to a provider.
 */

/** The member's input. Written by the upload step in a later part. */
export const AI_SOURCE_BUCKET = "frenz-ai-source";
/** The provider's output. Written by the webhook handler in a later part. */
export const AI_RESULT_BUCKET = "frenz-ai-results";

export type AiBucket = typeof AI_SOURCE_BUCKET | typeof AI_RESULT_BUCKET;

/**
 * Object keys are `<userId>/<feature>/<jobId>/<role>.<ext>`.
 *
 * The owner's id FIRST, before anything else, because that prefix is what a
 * bucket policy can be written against later — `storage.foldername(name)[1] =
 * auth.uid()::text` is the standard Supabase shape, and a key that buries the
 * owner in the middle can never be secured that way without rewriting every
 * path already stored.
 *
 * The job id makes every object traceable back to one row, which is what lets a
 * cleanup worker delete by `expires_at` without a second index of its own.
 */
function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
}

function safeExt(ext: string): string {
  return ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
}

export function aiSourceKey(userId: string, feature: AiFeature, jobId: string, ext: string): string {
  return `${safeSegment(userId)}/${safeSegment(feature)}/${safeSegment(jobId)}/source.${safeExt(ext)}`;
}

export function aiResultKey(userId: string, feature: AiFeature, jobId: string, ext: string): string {
  return `${safeSegment(userId)}/${safeSegment(feature)}/${safeSegment(jobId)}/result.${safeExt(ext)}`;
}

/**
 * Does this stored path really belong to this member and this job?
 *
 * 🔴 The check that has to exist before anything mints a signed URL. A signed
 * URL is authority over an object, and the request that asks for one arrives
 * carrying a job id — so the only thing standing between "give me a link to my
 * job's result" and "give me a link to that object over there" is proving the
 * path came from the row, and that the row is the caller's.
 *
 * Written as a pure function so the rule can be tested without a bucket, and
 * used by the route that reads the path back out of the database rather than by
 * one that takes it from a request body. A path must never arrive from a client
 * at all; this is the second line, not the first.
 */
export function pathBelongsTo(path: string, userId: string, jobId: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.length !== 4) return false;
  return segments[0] === safeSegment(userId) && segments[2] === safeSegment(jobId);
}

/**
 * How long a signed URL should live.
 *
 * Ten minutes: long enough to start a download on a slow phone connection,
 * short enough that a link copied out of a share sheet or a server log stops
 * working before it can be passed around. A later part mints them; the number
 * lives here so it is decided once.
 */
export const AI_SIGNED_URL_TTL_SECONDS = 600;
