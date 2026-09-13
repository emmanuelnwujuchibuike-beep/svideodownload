import type { AiLedgerEntry } from "@/lib/ai/balance";
import type { CharacterReplaceAudioMode, CharacterReplaceConfig, CharacterReplaceLipSyncTier, CharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import type { AiJobStatus, AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the vocabulary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §19): the architecture should be able to
 * represent a project, its two assets, the three settings groups, a pricing
 * snapshot, the balance and its transactions, a processing job with a status,
 * a result, and the pricing configuration — "Do not blindly create all of
 * these as database tables if the existing architecture has a better pattern."
 *
 * It does, and this file says which is which:
 *
 *   · A PROJECT is browser state. It is the member's draft — two files they
 *     have picked and the settings they have chosen — and it exists only until
 *     they press Start. Nothing about it is stored until then (§6: "Do not
 *     actually send the files to the AI model yet"), so it is a type here and
 *     a `useReducer` in the workspace, not a table.
 *   · A PROCESSING JOB is `ai_jobs`. One row per unit of AI work, the tool as a
 *     column, already carrying the source, the funding, the result and the
 *     retention — everything Part 2 needs except a second asset path and the
 *     settings, which are a column each on the same row when they land.
 *   · The BALANCE and its TRANSACTIONS are `ai_balances` and
 *     `ai_balance_ledger`. See balance.ts in this folder for why that wallet
 *     is this tool's wallet and not a second one.
 *   · The RESULT is the finished job read through `AiJobView` plus the
 *     settings it was made with.
 *   · The PRICING CONFIGURATION is `CharacterReplaceConfig` (config.ts),
 *     stored under one key in the operator settings row.
 *
 * Pure types. No runtime, no imports that would drag a server module into a
 * client bundle.
 */

/* ───────────────────────────── the draft ─────────────────────────────────── */

/** The reference photo, once picked and validated in the browser. */
export interface CharacterAsset {
  file: File;
  /** A `URL.createObjectURL` the picker owns and revokes. */
  objectUrl: string;
  width: number | null;
  height: number | null;
  /** Bytes, as the browser reports them. A claim until storage confirms it. */
  size: number;
  mimeType: string;
  name: string;
}

/** The video to transform, once picked, decoded for its facts, and validated. */
export interface SourceVideo {
  file: File;
  objectUrl: string;
  /** Seconds, from the browser's decoder. Null when the container hid it. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  size: number;
  mimeType: string;
  name: string;
}

/** Output settings. Every value is one the server's public config offered. */
export interface VideoSettings {
  quality: CharacterReplaceQualityId;
  /**
   * The kept range, in seconds from the start of the source. `end` is
   * exclusive. Both null means "the whole video". Trimming is how a member
   * reduces their price (§7), so it is part of the settings rather than a
   * separate step.
   */
  trim: { start: number; end: number } | null;
}

/** Whether the original sound is kept or a new voice is generated. */
export interface VoiceSettings {
  mode: CharacterReplaceAudioMode;
  /** Only read when `mode` is "new_voice". */
  languageCode: string | null;
  voiceId: string | null;
}

/** Only meaningful with a new voice; a member cannot lip-sync the original. */
export interface LipSyncSettings {
  tier: CharacterReplaceLipSyncTier | null;
}

/**
 * The member's draft, from the first pick to the confirmation. Held in the
 * workspace reducer and NOWHERE else until Start.
 */
export interface CharacterReplaceProject {
  character: CharacterAsset | null;
  video: SourceVideo | null;
  settings: VideoSettings;
  voice: VoiceSettings;
  lipSync: LipSyncSettings;
  /** §12: "I confirm that I have the right to use this likeness and content." */
  consent: boolean;
}

/* ───────────────────────────── money ─────────────────────────────────────── */

/**
 * A price, as the SERVER said it.
 *
 * ── 🔴 THE BROWSER NEVER PRODUCES ONE OF THESE ───────────────────────────────
 *
 * §10/§11: "Do NOT trust a frontend-supplied price… The backend must calculate
 * and validate the final amount." A snapshot is the server's answer to a quote
 * request, carried in the interface for display and handed back — by its `id`,
 * not its numbers — when the member confirms, so the server can check the
 * price it quoted is the price it charges.
 *
 * In Part 1 no engine exists, and the interface holds a `PricingState` of
 * `pending` for the whole flow. The shape is here so Part 2's engine has a
 * contract to fill.
 */
export interface PricingSnapshot {
  /** Opaque; issued by the server, echoed back on confirm. */
  id: string;
  currency: string;
  symbol: string;
  /** Each line as the summary card prints it. */
  lines: readonly PricingLine[];
  totalCents: number;
  /** "You save ₦X by choosing 720p" — informative, never manipulative (§10). */
  savings: readonly PricingSaving[];
  /** The server's quote is only good for so long; after this, ask again. */
  expiresAt: string;
}

export interface PricingLine {
  key: "video" | "quality" | "character" | "voice" | "lipSync" | "minimum" | "base";
  label: string;
  /** "10.0 sec", "720p", "Included", "Not selected". */
  value: string;
  /** Null for a line that carries no amount of its own ("Included"). */
  amountCents: number | null;
}

export interface PricingSaving {
  /** What the member could change, in one sentence. */
  message: string;
  savesCents: number;
}

/**
 * What the price area is showing right now.
 *
 *   idle      nothing to quote yet — no video, or the tool is off
 *   pending   the inputs are complete and the engine has not answered. In
 *             Part 1 this is the terminal state: `pricingAvailable` is false
 *             on every deployment and the card says so in words.
 *   quoted    the server's snapshot, current for these inputs
 *   stale     the inputs changed after the snapshot; a new quote is owed
 *   error     the quote request failed; the member may retry
 */
export type PricingState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "quoted"; snapshot: PricingSnapshot }
  | { status: "stale"; snapshot: PricingSnapshot }
  | { status: "error"; message: string };

/**
 * This tool's balance, as the interface holds it.
 *
 * Read through the platform wallet — see balance.ts — and shaped for the
 * balance card: the figure, the currency, and where "Recharge" goes.
 */
export interface CharacterReplaceBalance {
  balanceCents: number;
  currency: string;
  symbol: string;
  /** The amounts the recharge sheet offers, from the operator's minimum. */
  topupOptionsCents: readonly number[];
  minTopupCents: number;
  maxTopupCents: number;
}

/** One movement of money, as the ledger records it. The platform's own row. */
export type CharacterReplaceTransaction = AiLedgerEntry;

/* ───────────────────────────── processing ────────────────────────────────── */

/**
 * §13's states, in order. The first two are BROWSER phases (nothing is on the
 * server yet); the rest are the platform job's own statuses, with `refunded`
 * as the failed job whose charge went back.
 */
export type ProcessingStatus =
  | "preparing"
  | "uploading"
  | "queued"
  | "processing"
  | "finalizing"
  | "complete"
  | "failed"
  | "refunded"
  | "cancelled";

export const PROCESSING_STATUSES: readonly ProcessingStatus[] = [
  "preparing",
  "uploading",
  "queued",
  "processing",
  "finalizing",
  "complete",
  "failed",
  "refunded",
  "cancelled",
] as const;

/** The stages the tracker draws, in order. Terminal states are not stages. */
export const PROCESSING_STAGES: readonly { key: ProcessingStatus; label: string }[] = [
  { key: "preparing", label: "Preparing" },
  { key: "uploading", label: "Uploading" },
  { key: "queued", label: "Queued" },
  { key: "processing", label: "Processing" },
  { key: "finalizing", label: "Finalizing" },
  { key: "complete", label: "Complete" },
] as const;

/**
 * A job in flight, as the processing screen sees it. Wraps the platform's
 * `AiJobView` (the server's truth) with the two browser-side phases the server
 * cannot know about and the progress the interface can honestly claim.
 */
export interface ProcessingJob {
  status: ProcessingStatus;
  /** Null until the server has a row — i.e. through `preparing`. */
  job: AiJobView | null;
  /** 0–1 for a MEASURED phase (bytes sent); null when nothing is measured. */
  progress: number | null;
  /** Seconds, when the server has a real estimate; null otherwise. Never invented. */
  estimatedSecondsRemaining: number | null;
  /** Whether the member may stop it here without leaving a charge behind. */
  canCancel: boolean;
  /** A sentence for the failed/refunded states; null otherwise. */
  message: string | null;
}

/**
 * The platform status → §13's vocabulary. `refunded` needs the funding row,
 * which the view carries as `charged`/`refunded` once Part 2 exposes it; until
 * then a failed paid job reads as `failed` with the refund sentence.
 */
export function processingStatusFor(status: AiJobStatus): ProcessingStatus {
  switch (status) {
    case "queued":
    case "acquiring":
      return "queued";
    case "processing":
      return "processing";
    case "finalizing":
      return "finalizing";
    case "completed":
      return "complete";
    case "failed":
    case "expired":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function isProcessingActive(status: ProcessingStatus): boolean {
  return status === "preparing" || status === "uploading" || status === "queued" || status === "processing" || status === "finalizing";
}

/* ───────────────────────────── the result ────────────────────────────────── */

/** A finished job and what it was made with — the result screen's props. */
export interface CharacterReplaceResult {
  job: AiJobView;
  /** A short-lived signed URL for the player; re-fetched when it expires. */
  previewUrl: string | null;
  durationSeconds: number | null;
  quality: CharacterReplaceQualityId | null;
  voice: VoiceSettings | null;
  lipSync: LipSyncSettings | null;
}

/** §19's last name is the config module's type; re-exported so the vocabulary is complete here. */
export type PricingConfiguration = CharacterReplaceConfig;
