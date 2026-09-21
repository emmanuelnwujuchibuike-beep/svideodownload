import type { CharacterReplaceCreditsView } from "@/lib/ai/character-replace/types";
import type { AiJobView } from "@/lib/ai/jobs";
import type { LipSyncDurationPolicy, LipSyncPublicConfig } from "@/lib/ai/lip-sync/config";

/**
 * The browser's side of Lip Sync Pro: four calls, every answer the server's.
 * No price is computed here, no provider is named here, and the speech
 * source is sent as ONE object — text or audio, never both (§3).
 */
export type LipSyncClientResult<T> = ({ ok: true } & T) | { ok: false; code: string; error: string; extra?: Record<string, unknown> };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<LipSyncClientResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; error?: string } & Record<string, unknown>;
    const { code: _c, error: _e, ...extra } = b;
    void _c;
    void _e;
    return { ok: false, code: b.code ?? "INTERNAL_ERROR", error: b.error ?? "Something went wrong. Try again in a moment.", extra };
  }
  return { ok: true, ...((body ?? {}) as T) };
}

export interface LipSyncVoiceOption {
  id: string;
  label: string;
  blurb: string;
  languages: readonly string[];
  gender: string;
  age?: string;
}
export interface LipSyncLanguageOption {
  code: string;
  label: string;
  native: string;
}
export interface LipSyncConfigAnswer {
  config: LipSyncPublicConfig & { voices: LipSyncVoiceOption[]; languages: LipSyncLanguageOption[] };
  available: boolean;
  unavailableReason: string | null;
  processingAvailable: boolean;
  processingUnavailableReason: string | null;
  audience: string;
}

export function getLipSyncConfig(): Promise<LipSyncClientResult<LipSyncConfigAnswer>> {
  return request("/api/ai/lip-sync/config");
}

export interface LipSyncQuoteView {
  id: string;
  durationMs: number;
  speechSource: "text" | "audio";
  speechPath: "native" | "tts" | "audio";
  textCharacters: number;
  routeKey: string;
  perSecondCents: number;
  lines: { key: string; label: string; amountCents: number }[];
  lipSyncCents: number;
  ttsCents: number;
  totalCents: number;
  currency: string;
  pricingConfigVersion: number;
  expiresAt: string;
}
export interface LipSyncQuoteAnswer {
  quote: LipSyncQuoteView;
  creditsEstimate: number;
  credits: CharacterReplaceCreditsView | null;
  walletFallback: "allow" | "ask" | "off";
  walletOffered: boolean;
  balanceCents: number;
  afterCents: number;
  sufficient: boolean;
  shortfallCents: number;
  billing: { complimentary: boolean; remaining: number | null; reason: string };
  speech: { path: "native" | "tts" | "audio"; estimateMs: number | null; mismatch: "speech_longer" | "speech_shorter" | null; policy: LipSyncDurationPolicy };
}

export function getLipSyncQuote(input: { selectedDurationMs: number; speechSource: "text" | "audio"; textCharacters?: number; speed?: number }, signal?: AbortSignal): Promise<LipSyncClientResult<LipSyncQuoteAnswer>> {
  return request("/api/ai/lip-sync/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal });
}

export interface LipSyncUploadTicket {
  path: string;
  uploadUrl: string;
  expiresIn: number;
}

export type LipSyncSpeechInput = { source: "text"; text: string; voiceId?: string | null; languageCode?: string | null; speed?: number } | { source: "audio"; audio: { name: string; mimeType: string; size: number; durationMs: number | null } };

export function createLipSyncJob(input: {
  clientRequestId: string;
  retryOf?: string;
  video: { name: string; mimeType: string; size: number; durationMs: number; width: number; height: number; hasAudio?: boolean | null };
  speech: LipSyncSpeechInput;
  settings?: { expression?: "natural" | "balanced" | "expressive" | null; activeSpeaker?: boolean };
}): Promise<LipSyncClientResult<{ job: AiJobView; created: boolean; uploads: { video: LipSyncUploadTicket; audio: LipSyncUploadTicket | null } | null }>> {
  return request("/api/ai/lip-sync/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

export function startLipSyncJob(
  jobId: string,
  input: { quote: Pick<LipSyncQuoteView, "id" | "durationMs" | "speechSource" | "speechPath" | "textCharacters" | "routeKey" | "totalCents" | "currency" | "pricingConfigVersion" | "expiresAt">; trim: { startMs: number; endMs: number } | null; consent: true; funding?: "credits" | "wallet" },
): Promise<LipSyncClientResult<{ job: AiJobView; started: boolean; balanceCents: number | null; billing: "free" | "credits" | "paid" | null; credits: CharacterReplaceCreditsView | null }>> {
  return request(`/api/ai/lip-sync/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

/** The quote fields the start body echoes — exactly the signed ones. */
export function quoteFieldsForStart(q: LipSyncQuoteView) {
  return { id: q.id, durationMs: q.durationMs, speechSource: q.speechSource, speechPath: q.speechPath, textCharacters: q.textCharacters, routeKey: q.routeKey, totalCents: q.totalCents, currency: q.currency, pricingConfigVersion: q.pricingConfigVersion, expiresAt: q.expiresAt };
}
