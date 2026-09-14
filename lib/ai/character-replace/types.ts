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

/* ───────────────────────────── video metadata (Part 2, §6–§7) ────────────── */

/**
 * A reduced aspect ratio, and the name a member knows it by. "9:16" for a
 * phone video; the raw pair stays beside it for anything that needs the
 * numbers.
 */
export interface AspectRatio {
  w: number;
  h: number;
  /** "9:16", "16:9", "1:1", "4:5" — or "w:h" reduced when it is none of those. */
  label: string;
  orientation: "portrait" | "landscape" | "square";
}

/**
 * Everything the browser can honestly read off a picked video, in one object
 * the trim, the validation, the summary and — later — the pricing engine and
 * the result history all read from.
 *
 * ── 🔴 DURATION IS CARRIED IN MILLISECONDS, AS AN INTEGER ───────────────────
 *
 * Part 2, §7: "Keep an accurate numeric value internally… Avoid floating-point
 * mistakes when converting duration into billing units." `durationMs` is
 * `Math.round(seconds × 1000)` — exact, addable, comparable — and every
 * display rounds from it at the last moment. The billing unit is decided by
 * the server (Part 3); it will receive milliseconds and never a "18.4".
 *
 * ── What is null, and why ───────────────────────────────────────────────────
 *
 * A browser exposes duration and frame size on `loadedmetadata` and nothing
 * else. Frame rate and codec are not readable without decoding frames or a
 * container parser, and audio presence is only reported by some engines
 * (Safari's `audioTracks`, Firefox's `mozHasAudio`). Those fields are
 * `null` for "not known", never a guessed value: the server's ffprobe is the
 * authority on all of them, and a null here is what tells it to look.
 */
export interface VideoMetadata {
  /** Integer milliseconds. Null when the container hid its duration. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  aspect: AspectRatio | null;
  /** "720p", "1080p", "4K" — from the shorter edge; null when unmeasured. */
  resolutionLabel: string | null;
  sizeBytes: number;
  mimeType: string;
  /** "mp4" | "mov" | "webm" — from the name, then the type. */
  container: string;
  /** Frames per second, when the browser can say. Null otherwise. */
  frameRate: number | null;
  /** The video codec, when the browser can say. Null otherwise. */
  videoCodec: string | null;
  /** True/false only from an engine that reports it; null means unknown. */
  hasAudio: boolean | null;
  /** Integer milliseconds, when an audio track's own length is known. */
  audioDurationMs: number | null;
}

/** The video to transform, once picked, decoded for its facts, and validated. */
export interface SourceVideo {
  file: File;
  objectUrl: string;
  name: string;
  size: number;
  mimeType: string;
  metadata: VideoMetadata;
}

/* ───────────────────────────── the asset slots (Part 2, §20) ─────────────── */

/**
 * What one picker is doing, as a discriminated union — so the interface can
 * never be "ready" while the file is gone, or "uploading" with nothing to
 * send. The asset itself lives on the project; the slot says what is true
 * about it. `selecting` is the file dialog being open, which a browser does
 * not report, so it is a state the interface may set but never depends on.
 */
export type AssetSlotStatus = "empty" | "selecting" | "validating" | "uploading" | "ready" | "invalid" | "error";

export type AssetSlot =
  | { status: "empty" }
  | { status: "selecting" }
  | { status: "validating" }
  /** The bytes are on their way to storage (a later part). 0–1. */
  | { status: "uploading"; progress: number }
  | { status: "ready" }
  /** The file was refused by a rule — format, size, length — in the media error vocabulary. */
  | { status: "invalid"; code: string }
  /** Something failed that was not the file's fault — the decoder, storage. */
  | { status: "error"; code: string };

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
 * Since Part 3 the engine exists: POST /api/ai/character-replace/quote
 * answers with a signed `CharacterReplaceQuote`, which the interface stores
 * here unchanged. `pending` is now only the beat between a change of inputs
 * and the server's answer.
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
  /*
    Part 3: the breakdown behind the total, as the server computed it, so
    "Price details" can print the arithmetic without repeating it. The
    server's `CharacterReplaceQuote` (lib/ai/character-replace/pricing.ts)
    carries all of these and is what the interface stores here.
  */
  /** The kept duration the price is for, integer milliseconds. */
  durationMs: number;
  /** The sum of the lines before the floor. */
  subtotalCents: number;
  /** The operator's floor, and whether it was the total. */
  minimumChargeCents: number;
  minimumApplied: boolean;
  /** Which pricing configuration produced this; the server checks it at confirm. */
  pricingConfigVersion: number;
  /** The inputs it was priced for — handed back, signed, at /start (Part 4). */
  quality: CharacterReplaceQualityId;
  voiceMode: CharacterReplaceAudioMode;
  lipSyncMode: CharacterReplaceLipSyncTier | null;
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

/* ───────────────────────────── the job input (Part 2, §14) ───────────────── */

/**
 * What the browser will hand the server when Start is pressed: the member's
 * choices and the facts the browser read, as plain JSON — no File, no object
 * URL, nothing a structured clone would refuse.
 *
 * ── 🔴 EVERY NUMBER HERE IS A CLAIM ─────────────────────────────────────────
 *
 * §14/§19: "Never trust client-provided pricing information. The client only
 * prepares input." The server re-measures the uploaded file (ffprobe on the
 * worker), re-checks every ceiling, and prices from ITS numbers; these are
 * carried so the two can be compared and so the job row can record what the
 * member saw. There is no price field and there never will be.
 */
export interface CharacterReplaceJobInput {
  photo: {
    name: string;
    sizeBytes: number;
    mimeType: string;
    width: number | null;
    height: number | null;
  };
  video: {
    name: string;
    sizeBytes: number;
    mimeType: string;
    container: string;
    originalDurationMs: number | null;
    sourceWidth: number | null;
    sourceHeight: number | null;
    sourceResolution: string | null;
    aspect: string | null;
    hasAudio: boolean | null;
    frameRate: number | null;
  };
  trim: {
    /** Integer milliseconds from the start of the source; end exclusive. */
    startMs: number;
    endMs: number;
    selectedDurationMs: number;
    /** True when the kept range is the whole video. */
    whole: boolean;
  };
  output: {
    requestedQuality: CharacterReplaceQualityId;
  };
  audio: {
    voiceMode: CharacterReplaceAudioMode;
    languageCode: string | null;
    voiceId: string | null;
    lipSyncMode: CharacterReplaceLipSyncTier | null;
  };
  consent: boolean;
}
