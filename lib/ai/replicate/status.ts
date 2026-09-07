import type { AiJobStatus } from "@/lib/ai/jobs";

/**
 * Replicate's vocabulary, translated into ours.
 *
 * ── Why a translation and not the provider's own word ────────────────────────
 *
 * The interface must never learn a provider's vocabulary. The moment a
 * component branches on `"succeeded"`, swapping or adding a provider means
 * touching the UI, and a second provider with a different word for the same
 * thing means two vocabularies on one screen. One internal set of six statuses
 * (lib/ai/jobs.ts), translated at exactly one boundary — here.
 *
 * ── 🔴 AN UNKNOWN STATUS IS NOT A GUESS ──────────────────────────────────────
 *
 * `null` means "I do not recognise this", and every caller leaves the job
 * exactly as it was. That matters more than it looks: Replicate's own docs
 * render the success state as both `succeeded` and `successful` in different
 * places, and a mapper that fell back to "failed" or "completed" for anything
 * it did not know would either lose a finished job or announce one that never
 * ran. Both spellings are accepted; anything genuinely new is logged and
 * ignored until somebody adds it.
 */
const MAP: Record<string, AiJobStatus> = {
  starting: "queued",
  processing: "processing",
  succeeded: "completed",
  // Accepted because Replicate's documentation uses this spelling in places.
  // Costless to support and expensive to be wrong about.
  successful: "completed",
  failed: "failed",
  canceled: "cancelled",
  cancelled: "cancelled",
};

export function mapReplicateStatus(status: string | null | undefined): AiJobStatus | null {
  if (!status) return null;
  return MAP[status.trim().toLowerCase()] ?? null;
}

/**
 * The output, reduced to one video URL.
 *
 * Replicate models return whatever shape their author chose — a string, an
 * array of strings, or an object with a named field. All three are handled
 * because the alternative is a completed prediction we paid for and cannot
 * read. Anything else returns null, and the job fails with a code rather than
 * storing something that is not a video.
 */
export function extractOutputUrl(output: unknown): string | null {
  const fromString = (value: unknown): string | null =>
    typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null;

  const direct = fromString(output);
  if (direct) return direct;

  if (Array.isArray(output)) {
    // The last entry, not the first: models that emit progressive results put
    // the finished one at the end.
    for (let i = output.length - 1; i >= 0; i--) {
      const found = fromString(output[i]);
      if (found) return found;
    }
    return null;
  }

  if (output && typeof output === "object") {
    for (const key of ["video", "output", "url", "file"]) {
      const found = fromString((output as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }

  return null;
}
