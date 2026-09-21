import type { AiJobStatus } from "@/lib/ai/jobs";
import type { LipSyncCapabilities } from "@/lib/ai/lip-sync/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIP SYNC PRO PROVIDER SEAM (§4, §12, §17)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One adapter per MODEL, each declaring from its LIVE schema what it takes.
 * The request carries exactly ONE speech source; an adapter that cannot take
 * the one it was handed throws before anything is sent — the router never
 * hands it one (planSpeechPath), and the worker made audio for a text job on
 * an audio-only model, but the adapter is the last line, not the only one.
 *
 * Nothing here is sent that the schema does not name: an adapter builds the
 * payload field by field (buildInput is exported so a test can walk it).
 */
export type LipSyncSpeech =
  | { kind: "audio"; audioUrl: string }
  | { kind: "text"; text: string; providerVoiceId: string | null; languageCode: string | null; speed: number };

export interface LipSyncProRequest {
  jobId: string;
  /** The PREPARED video, signed. */
  videoUrl: string;
  speech: LipSyncSpeech;
  /** §7: the residual-mismatch behaviour for a provider with sync modes. */
  syncMode: "silence" | "loop" | "bounce";
  /** §9: the preset's temperature for a provider with the knob; null = do not send. */
  temperature: number | null;
  /** §8: for a provider that can target the speaker; null = do not send. */
  activeSpeaker: boolean | null;
  webhookUrl: string;
  /** The prepared video's measured facts, for an adapter with a documented input window. */
  facts?: { durationMs: number; width: number; height: number; bytes: number; fps?: number | null } | null;
  /** The prepared audio's measured facts (audio path). */
  audioFacts?: { durationMs: number; bytes: number; mime: string } | null;
}

export interface LipSyncProSubmission {
  reference: string;
  status: AiJobStatus;
  model: string;
  modelVersion: string | null;
  /** What was sent, minus the text and the URLs — for the operator's record. */
  settings: Record<string, unknown>;
}

export interface NativeVoice {
  id: string;
  label: string;
  /** BCP-47 primary subtag the voice speaks. */
  language: string;
  gender: "female" | "male" | "neutral";
}

export interface LipSyncProProvider {
  readonly id: "replicate" | "fal";
  readonly model: string;
  readonly version: string;
  readonly capabilities: LipSyncCapabilities;
  /** The model's OWN voices for text mode (a text-native model); null = the voice provider's catalogue applies. */
  readonly nativeVoices: readonly NativeVoice[] | null;
  isConfigured(): boolean;
  buildInput(req: Omit<LipSyncProRequest, "jobId" | "webhookUrl">): Record<string, unknown>;
  createPrediction(req: LipSyncProRequest): Promise<LipSyncProSubmission>;
}

/** A refusal an adapter raises for a request its schema cannot take — a routing fault, never a member's. */
export class LipSyncCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LipSyncCapabilityError";
  }
}

const https = (url: string, what: string): string => {
  if (!/^https:\/\//.test(url)) throw new Error(`${what} must be an https url`);
  return url;
};
export { https as requireHttps };
