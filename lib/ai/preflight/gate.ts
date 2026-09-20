import "server-only";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { StoredObject } from "@/lib/ai/storage-server";
import type { PreflightRecord } from "@/server/services/ai-preflight-service";

import { PREFLIGHT_TOKEN_TTL_MS, PREFLIGHT_VALIDATOR_VERSION } from "./config";
import { objectFingerprint, verifyPreflightToken } from "./token";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the gate Start passes through before anything is reserved
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Brief §12–§13, §25: "Only reserve/deduct credits after the validation
 * system explicitly returns valid: true and the server verifies that the
 * validation result belongs to the current user, files, mode and validator
 * version." Both halves are checked here — the record the WORKER stored on
 * the row (the truth) and the token the MEMBER handed back (their proof of
 * having seen it) — against the objects as they sit in the bucket at this
 * very moment.
 *
 * `AI_PREFLIGHT_ENFORCE=0` on Vercel switches the gate off for an emergency
 * (a worker without its models, say) — logged loudly, never the default.
 */
export const PREFLIGHT_ENFORCED = process.env.AI_PREFLIGHT_ENFORCE?.trim() !== "0";
/**
 * ── A VERDICT BLOCKS; A BROKEN CHECKER DOES NOT (Part 11 QA, 2026-09-20) ──
 * When the worker could not RUN the check (its models missing after a
 * deploy, the process down) the member's start is allowed with a signed
 * pass that says so — logged as an error and recorded on the job — rather
 * than every Character Replace on the platform stopping until an engineer
 * notices. `AI_PREFLIGHT_STRICT=1` turns that into a refusal for an
 * operator who prefers the outage. A NEGATIVE verdict always blocks.
 */
export const PREFLIGHT_STRICT = process.env.AI_PREFLIGHT_STRICT?.trim() === "1";
export const VALIDATOR_UNAVAILABLE = "validator_unavailable";

export type PreflightGateVerdict = { ok: true; record: PreflightRecord | null; skipped?: boolean } | { ok: false; reason: string };

/** The stored record, if it is one this build wrote (shape-checked, not trusted for its values until compared). */
export function readPreflightRecord(metadata: unknown): PreflightRecord | null {
  const p = (metadata as { preflight?: unknown } | null)?.preflight;
  if (!p || typeof p !== "object") return null;
  const r = p as Partial<PreflightRecord>;
  if (typeof r.version !== "number" || typeof r.mode !== "string" || typeof r.checkedAt !== "string" || !r.media || !r.result || typeof r.result.valid !== "boolean") return null;
  return r as PreflightRecord;
}

/** Whether a stored record still describes THESE objects, this mode and this validator, and is fresh. */
export function recordMatches(record: PreflightRecord, mode: ReplacementMode, reference: StoredObject | null, video: StoredObject | null, now = Date.now()): boolean {
  if (record.version !== PREFLIGHT_VALIDATOR_VERSION || record.mode !== mode) return false;
  if (record.media.reference !== objectFingerprint(reference) || record.media.video !== objectFingerprint(video)) return false;
  const at = Date.parse(record.checkedAt);
  return Number.isFinite(at) && now - at < PREFLIGHT_TOKEN_TTL_MS;
}

export function preflightGate(opts: {
  jobId: string;
  userId: string;
  mode: ReplacementMode;
  metadata: unknown;
  reference: StoredObject | null;
  video: StoredObject | null;
  token: string | undefined;
}): PreflightGateVerdict {
  if (!PREFLIGHT_ENFORCED) {
    console.warn("[cr/preflight] gate is OFF (AI_PREFLIGHT_ENFORCE=0) — starting without a media check", { jobId: opts.jobId });
    return { ok: true, record: null };
  }
  const record = readPreflightRecord(opts.metadata);
  if (!record) return { ok: false, reason: "no preflight record on the job" };
  const unavailable = record.result.errors.includes(VALIDATOR_UNAVAILABLE);
  if (unavailable && PREFLIGHT_STRICT) return { ok: false, reason: "the checker was unavailable and AI_PREFLIGHT_STRICT=1" };
  if (!unavailable) {
    if (!record.result.valid) return { ok: false, reason: `preflight did not pass: ${record.result.errors.join(",")}` };
    if (!recordMatches(record, opts.mode, opts.reference, opts.video)) return { ok: false, reason: "preflight record is for other files, another mode, an older validator, or has expired" };
  } else if (record.mode !== opts.mode || record.version !== PREFLIGHT_VALIDATOR_VERSION) {
    return { ok: false, reason: "the unavailable record is for another mode or validator" };
  }
  // The token binds the job, the member, the mode and THESE objects either way — a pass for other files never starts this one.
  if (!opts.token) return { ok: false, reason: "no preflight token in the start body" };
  const verdict = verifyPreflightToken(opts.token, { jobId: opts.jobId, userId: opts.userId, mode: opts.mode, reference: objectFingerprint(opts.reference), video: objectFingerprint(opts.video) });
  if (!verdict.ok) return { ok: false, reason: `preflight token ${verdict.reason}` };
  if (unavailable) {
    console.error("[cr/preflight] gate PASSED WITHOUT A CHECK — the worker could not run the media check for this job", { jobId: opts.jobId });
    return { ok: true, record, skipped: true };
  }
  return { ok: true, record };
}
