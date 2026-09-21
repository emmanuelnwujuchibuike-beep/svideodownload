import { z } from "zod";

import { REPLACEMENT_MODE } from "@/lib/ai/character-replace/quote-schema";
import { createCharacterReplaceJobSchema, startCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";

/**
 * The bodies of the multi-video routes (0166) — pure zod, tested without
 * the routes' server imports, and built FROM the single-job schemas so a
 * video's facts or a start's quote cannot be described two ways.
 *
 * ── Create ──────────────────────────────────────────────────────────────────
 * ONE photo (+ references, + a replacement audio file) and MANY videos: the
 * member is putting the same character into several videos with the same
 * settings. `batchRequestId` makes the whole create idempotent — a retry of
 * the request returns the rows it already made — and each job's own
 * `client_request_id` is `<batchRequestId>:<index>`.
 *
 * ── Start ───────────────────────────────────────────────────────────────────
 * One start body per job: its own signed quote (the price depends on the
 * video's length) and its own preflight token (the pass is for exactly that
 * video), the shared voice choice. No trim: in a batch every video runs at
 * full length — the trim handles are per video and the workspace offers
 * them for a single one.
 */
const single = createCharacterReplaceJobSchema.shape;
const videoFacts = single.video;

export const BATCH_HARD_MAX = 20;

export const createCharacterReplaceBatchSchema = z
  .object({
    batchRequestId: z.string().min(8).max(100),
    mode: REPLACEMENT_MODE.optional(),
    photo: single.photo,
    references: single.references,
    audio: single.audio,
    videos: z.array(videoFacts).min(1).max(BATCH_HARD_MAX),
  })
  .strict();

export type CreateCharacterReplaceBatchRequest = z.infer<typeof createCharacterReplaceBatchSchema>;

const startShape = startCharacterReplaceJobSchema.shape;

export const startCharacterReplaceBatchSchema = z
  .object({
    jobs: z
      .array(
        z
          .object({
            jobId: z.string().uuid(),
            quote: startShape.quote,
            preflightToken: startShape.preflightToken,
            voice: startShape.voice,
            funding: startShape.funding,
          })
          .strict(),
      )
      .min(1)
      .max(BATCH_HARD_MAX),
    consent: z.literal(true),
  })
  .strict();

export type StartCharacterReplaceBatchRequest = z.infer<typeof startCharacterReplaceBatchSchema>;

/** A stable, opaque-enough batch id for a request id: v5-style, derived so a retried create maps to the same batch. */
export function isValidBatchRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}
