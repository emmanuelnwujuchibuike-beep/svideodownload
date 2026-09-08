/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — every way a job can be refused, said once
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Two audiences, one table ─────────────────────────────────────────────────
 *
 * A failure has to reach two readers who need opposite things. The MEMBER needs
 * a sentence that says what happened and what to do, with no codes and no
 * provider vocabulary. The OPERATOR needs something stable to search logs and
 * dashboards by, that survives the copy being rewritten. So every failure
 * carries both: a `code` that never changes and a `message` that may.
 *
 * ── 🔴 What must never cross this boundary ───────────────────────────────────
 *
 * A provider's error body is not a user-facing message. It can carry account
 * identifiers, model names, internal URLs, quota states and stack traces, and
 * this project has already had one incident of an upstream body being passed
 * through to a client. Detail from a provider goes to `ai_jobs.error_message`,
 * which is service-role-only and never selected into a client response; the
 * browser gets a code from this table and the sentence beside it.
 *
 * Pure data — no next/server, no DB. That is deliberate: the same table is the
 * one the browser client maps codes with, so the two can never drift.
 */

export type AiErrorCode =
  | "AUTH_REQUIRED"
  | "FEATURE_UNAVAILABLE"
  | "DAILY_LIMIT_REACHED"
  | "INVALID_INPUT"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "JOB_NOT_FOUND"
  | "JOB_ALREADY_PROCESSING"
  | "PROVIDER_ERROR"
  /**
   * The provider refused for a reason on OUR side of the relationship —
   * billing, quota, throttling.
   *
   * 🔴 Separate from PROVIDER_ERROR because the advice differs. A transient
   * failure is worth retrying; an account with no credit is not, and telling
   * somebody to "try again in a moment" when the answer is 402 wastes their
   * time on a loop that cannot succeed. Observed in production 2026-09-08.
   */
  | "PROVIDER_UNAVAILABLE"
  /**
   * The job was accepted, dispatched, and then nothing ever came back.
   *
   * 🔴 Its own code because it is the only failure NOBODY observes. Every other
   * error here is something that happened; this one is something that stopped
   * happening, so there is no callback to carry it and no exception to catch —
   * the row simply sits at `processing` until a deadline notices. Without it
   * the member watches a spinner forever and their reservation is never given
   * back. See lib/ai/stall.ts.
   */
  | "PROVIDER_TIMEOUT"
  /**
   * The AI finished, and our own worker refused to take the result.
   *
   * 🔴 Distinct from PROVIDER_ERROR because the provider did nothing wrong and
   * the fix is entirely ours — a mismatched worker secret, or the finalize
   * route not deployed. Naming it separately is what turns "that didn't
   * finish" into a log line an operator can act on, and it is the failure that
   * silently consumed EVERY AI Clean job before 2026-09-08: the model
   * succeeded, our worker 403'd the handoff, and the job sat in `processing`
   * until it aged out.
   */
  | "FINALIZER_UNAVAILABLE"
  /** This plan owes a rewarded ad and the request arrived without one. */
  | "REWARD_REQUIRED"
  /** A reward was presented and the database refused to spend it. */
  | "REWARD_INVALID"
  | "PROCESSING_FAILED"
  | "STORAGE_ERROR"
  | "RATE_LIMITED"
  /*
    Not in the owner's list, which was written as examples. It is here because
    without it the create path has no honest code for "the database refused to
    record your job": `PROCESSING_FAILED` would claim work was attempted,
    `PROVIDER_ERROR` would blame a provider that was never called, and either
    would send whoever reads the logs to the wrong place.
  */
  | "INTERNAL_ERROR";

export interface AiErrorSpec {
  /** The HTTP status this code answers with. */
  status: number;
  /** What the member reads. One sentence, no jargon, no code. */
  message: string;
}

export const AI_ERRORS: Record<AiErrorCode, AiErrorSpec> = {
  AUTH_REQUIRED: { status: 401, message: "Sign in to use Frenz AI." },
  // 503, not 403: the member is not forbidden, the tool is not running. A 403
  // would tell them to go away; this tells them to come back.
  FEATURE_UNAVAILABLE: { status: 503, message: "This tool isn't available yet." },
  DAILY_LIMIT_REACHED: { status: 429, message: "You've used today's free AI videos. They reset at midnight UTC." },
  INVALID_INPUT: { status: 400, message: "We couldn't use that request. Try again." },
  FILE_TOO_LARGE: { status: 413, message: "That video is too large for AI Clean." },
  UNSUPPORTED_FORMAT: { status: 415, message: "AI Clean takes MP4, MOV, WebM and AVI videos." },
  JOB_NOT_FOUND: { status: 404, message: "We couldn't find that job." },
  JOB_ALREADY_PROCESSING: { status: 409, message: "You already have a video being cleaned. Wait for it to finish." },
  // 502 for a provider that answered badly, 500 for work that genuinely broke.
  // The member sees the same sentence either way; the status is for us.
  PROVIDER_ERROR: { status: 502, message: "The AI service didn't respond. Nothing was charged — try again." },
  /*
    Deliberately vague about WHY. "Our provider account is out of credit" is an
    operations problem, and telling the member whose video it is would be both
    confusing and an invitation. What they need to know is that it is not their
    fault, they were not charged, and waiting is the right move — all three of
    which are true.
  */
  REWARD_REQUIRED: {
    status: 402,
    message: "Watch a short ad to unlock this clean.",
  },
  /*
    ONE sentence for every refusal — expired, already spent, wrong owner, wrong
    feature. Which check a claim failed is exactly what an attacker wants to
    learn, and a member only needs to know to try again.
  */
  REWARD_INVALID: {
    status: 403,
    message: "We couldn't verify that reward. Please try again.",
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: "AI Clean is temporarily unavailable. Nothing was charged — please try again later.",
  },
  PROVIDER_TIMEOUT: {
    status: 504,
    // Says what happened and what it cost, because both are the member's
    // questions and a job that ran too long is not their mistake.
    message: "This one took too long and we stopped waiting. Your allowance wasn't used — try again, or try a shorter clip.",
  },
  FINALIZER_UNAVAILABLE: {
    status: 503,
    // Says what it cost, because that is the member's real question, and does
    // not blame them or the video — this one is entirely on us.
    message: "We couldn't finish this video. Your allowance wasn't used — please try again shortly.",
  },
  PROCESSING_FAILED: { status: 500, message: "The cleanup didn't finish. Nothing was changed — you can try again." },
  STORAGE_ERROR: { status: 500, message: "We couldn't save that file. Try again in a moment." },
  RATE_LIMITED: { status: 429, message: "You're going a bit fast — give it a moment." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Nothing was charged — try again in a moment." },
};

export function aiErrorStatus(code: AiErrorCode): number {
  return AI_ERRORS[code].status;
}

export function aiErrorMessage(code: AiErrorCode): string {
  return AI_ERRORS[code].message;
}

/**
 * The sentence for a code READ BACK OUT OF THE DATABASE.
 *
 * `ai_jobs.error_code` is text, and rows written by an older release can carry
 * a code this build no longer knows. Falling back to a written sentence keeps a
 * history page readable instead of showing somebody a raw token, and it means a
 * renamed code degrades rather than leaks.
 */
export function storedErrorMessage(code: string): string {
  return AI_ERRORS[code as AiErrorCode]?.message ?? "That job didn't finish.";
}

/**
 * The exact JSON shape every Frenz AI failure uses.
 *
 * `extra` carries the small, safe facts a specific refusal needs — the
 * remaining allowance on a limit, the reason a feature is off. It is spread
 * LAST deliberately: a caller may override the default sentence with something
 * more specific (the real reason a feature is unavailable, for instance)
 * without inventing a second response shape to do it in.
 */
export function aiErrorBody(
  code: AiErrorCode,
  extra?: Record<string, unknown>,
): { code: AiErrorCode; error: string } & Record<string, unknown> {
  return { code, error: AI_ERRORS[code].message, ...extra };
}

/**
 * A failure that carries its own code, for throwing across the service layer.
 *
 * The route catches this and answers with the code's own status, so a helper
 * three calls deep can refuse a request precisely without every caller in
 * between having to forward a discriminated union by hand.
 */
export class AiJobError extends Error {
  readonly code: AiErrorCode;
  /** Operator-facing detail. Logged and stored; never returned to a client. */
  readonly detail?: string;

  constructor(code: AiErrorCode, detail?: string) {
    super(AI_ERRORS[code].message);
    this.name = "AiJobError";
    this.code = code;
    this.detail = detail;
  }
}

export function isAiJobError(e: unknown): e is AiJobError {
  return e instanceof AiJobError;
}
