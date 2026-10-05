/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE IDEMPOTENCY KEY FOR A PAID GENERATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A holder for the `clientRequestId` sent with a video generation, with one
 * job: send the SAME key for a retry of the same request, and a DIFFERENT key
 * once the request itself changes.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * It used to be one inline expression in `use-video-generation.ts`:
 *
 *     clientRequestId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
 *
 * under a comment promising "a double tap or a retry reaches the SAME job
 * rather than paying twice". A fresh uuid on every call is the exact opposite,
 * so the promise was false and nothing in the repo could notice — the rule
 * lived inside a React hook, and this project has no DOM test environment, so
 * there was no artifact a test could hold. Pulled out here it is ordinary
 * synchronous logic with real tests (`idempotency-key.test.ts`).
 *
 * ── The server half (already correct, and this is what unlocks it) ──────────
 *
 * `ai_jobs` carries a unique partial index on (user_id, client_request_id)
 * (migration 0141). `createJob` catches the unique violation, re-reads the row
 * and reports `created: false`; `createKlingVideoJob` then returns that
 * existing job WITHOUT reserving a second charge. That machinery was complete
 * and unreachable, because the key was never sent twice.
 *
 * ── Both directions are money ───────────────────────────────────────────────
 *
 * Reusing too little → a retry buys a second generation. Reusing too much → an
 * edited prompt silently returns the OLD job. Hence `for(fingerprint)` rather
 * than a bare `get()`: the caller must say WHICH request it is asking about,
 * and a change of request is a change of key.
 */

/** 32 lowercase hex chars — inside `ai_jobs_client_request_id_chk` (8..100). */
function defaultMint(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

export interface IdempotencyKeyHolder {
  /**
   * The key to send for the request described by `fingerprint`.
   *
   * Stable across calls with the same fingerprint, so a retry repeats it.
   * A different fingerprint discards the old key and mints a new one.
   */
  for(fingerprint: string): string;
  /**
   * Forget the current key, so the next `for()` mints a fresh one.
   *
   * Called once a job has actually been created and paid for: that key now
   * identifies a real job, and reusing it would return that job instead of
   * starting the next one.
   */
  clear(): void;
}

export function createIdempotencyKeyHolder(mint: () => string = defaultMint): IdempotencyKeyHolder {
  let key: string | null = null;
  let seen: string | null = null;

  return {
    for(fingerprint: string): string {
      if (fingerprint !== seen) {
        seen = fingerprint;
        key = null;
      }
      key ??= mint();
      return key;
    },
    clear(): void {
      key = null;
    },
  };
}
