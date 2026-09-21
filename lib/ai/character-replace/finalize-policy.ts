/**
 * The finalization retry policy (Part 5, §10–§11) — pure, so it is testable
 * without a worker, and shared by the worker's finalizer and the recovery
 * sweep so the two never disagree about "how many" or "how long".
 */

/** Attempts before a finalization is given up. Replicate keeps the output about an hour; three fits inside it. */
export const FINALIZE_MAX_ATTEMPTS = 3;

/**
 * 0166: the operator's "Automatic retries" (AI → Processing) is the budget;
 * the constant above is its default and the floor/ceiling live in the
 * config normaliser (1–5). Pure — the caller reads the settings.
 */
export function finalizeMaxAttempts(config?: { processing?: { autoRetryCount?: number } } | null): number {
  const n = config?.processing?.autoRetryCount;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : FINALIZE_MAX_ATTEMPTS;
}
/** One finalizer owns the job this long. A 60 s clip with a colour pass is minutes; a crashed worker frees it by expiry. */
export const FINALIZE_LEASE_SECONDS = 15 * 60;
/** Backoff before attempt 2 and 3. Short first — a storage blip clears in seconds — longer after. */
export const FINALIZE_BACKOFF_MS: readonly number[] = [60_000, 5 * 60_000];

export function finalizeBackoffMs(attemptsSoFar: number): number {
  const i = Math.min(FINALIZE_BACKOFF_MS.length - 1, Math.max(0, attemptsSoFar - 1));
  return FINALIZE_BACKOFF_MS[i] ?? 60_000;
}

export type FinalizeFailureCode =
  | "AI_FINALIZATION_FAILED"
  | "AUDIO_RESTORE_FAILED"
  | "INVALID_AI_OUTPUT"
  | "INVALID_FINAL_VIDEO"
  | "FINAL_UPLOAD_FAILED"
  | "UNSUPPORTED_SOURCE"
  | "RESULT_NOT_FOUND";

/**
 * Which failures are worth another go. The provider's file being wrong is
 * not (it will be wrong again); its host answering 4xx is not (the file has
 * expired or was never there). Our storage, our network, our worker: yes.
 */
export function isTransientFinalizeFailure(code: FinalizeFailureCode, detail: string): boolean {
  if (code === "FINAL_UPLOAD_FAILED" || code === "AI_FINALIZATION_FAILED") return true;
  if (code === "INVALID_AI_OUTPUT" && detail.startsWith("download:")) return !/download failed: 4\d\d/.test(detail);
  return false;
}
