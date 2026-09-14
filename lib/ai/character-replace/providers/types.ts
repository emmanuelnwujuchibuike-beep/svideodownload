import "server-only";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality } from "@/lib/ai/character-replace/pricing";
import type { AiJobStatus } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE REPLACEMENT PROVIDER SEAM — one interface, three implementations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Skin + Face brief §12: "Create a single replacement router:
 * face_only → xrunda/hello · skin_face → prunaai/p-video-replace ·
 * full_character → existing Wan 2.2 Animate Replace. The three pipelines
 * must remain independently maintainable."
 *
 * Each adapter knows ONE model: its pin, its input names, how a quality tier
 * maps onto what it can be asked for. The application layer (submit.ts)
 * sees this interface and the router (router.ts) picks the adapter by mode.
 * Nothing here is built from a request; every value is the server's, after
 * validation, and the URLs are signed links into the private source bucket.
 */

export interface ReplacementRequest {
  jobId: string;
  mode: ReplacementMode;
  /** The prepared (trimmed, normalised) video, as a signed URL. */
  videoUrl: string;
  /** The reference image(s), primary first, as signed URLs. Face Only and Full Character use the first. */
  referenceImageUrls: readonly string[];
  /** The tier of THIS mode, already validated against the configuration. */
  quality: CharacterReplaceAnyQuality;
  /** Whether the source has audio the member wants kept — the adapter decides what to ask the model. */
  keepOriginalAudio: boolean;
  /** Full Character's `go_fast` (Part 4). Ignored by the other adapters. */
  goFast: boolean;
  webhookUrl: string;
}

export interface ReplacementSubmission {
  /** The provider's own id for this run. */
  reference: string;
  status: AiJobStatus;
  model: string;
  modelVersion: string | null;
  /** The provider settings the tier mapped to — recorded on the row for the operator. */
  settings: Record<string, unknown>;
  /** Whether the model was asked to keep the original audio in its output. */
  mergeAudio: boolean;
}

export interface ReplacementProvider {
  readonly id: "replicate";
  readonly mode: ReplacementMode;
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  /** Build the payload from validated values; exposed so a test can see exactly what would be sent. */
  buildInput(req: Omit<ReplacementRequest, "jobId" | "webhookUrl">): Record<string, unknown>;
  /** The provider settings for a tier, or null when the provider cannot honour it. */
  settingsFor(quality: CharacterReplaceAnyQuality): Record<string, unknown> | null;
  createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission>;
}
