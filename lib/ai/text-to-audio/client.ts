import type { AiCreditsView } from "@/lib/ai/wallet/client";
import type { AiJobView } from "@/lib/ai/jobs";
import type { TextToAudioPublicConfig } from "@/lib/ai/text-to-audio/config";
import { cachedMediaUrl, rememberMediaUrl } from "@/lib/ai/media-url-cache";

/**
 * The browser's view of Text to Audio and the Audio Library. Same shape as
 * the other tools' clients: one `request` helper, every answer a discriminated
 * result, no throwing. Nothing here knows a provider or a model id.
 */
export type TtaResult<T> = ({ ok: true } & T) | { ok: false; code: string; error: string; extra?: Record<string, unknown> };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<TtaResult<T>> {
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

export interface TtaVoiceOption {
  id: string;
  label: string;
  blurb: string;
  languages: readonly string[];
  gender: string;
  age?: string;
  /** 2026-09-27: one of the member's own cloned voices, so the picker can group them apart from the catalogue. */
  own?: boolean;
}
export interface TtaLanguageOption {
  code: string;
  label: string;
  native: string;
}
export interface TtaFreeState {
  allowance: number;
  used: number;
  remaining: number;
  monthKey: string;
}
export interface TtaConfigAnswer {
  config: TextToAudioPublicConfig & { voices: TtaVoiceOption[]; languages: TtaLanguageOption[] };
  free: TtaFreeState;
  available: boolean;
  unavailableReason: string | null;
  processingAvailable: boolean;
  audience: string;
  currency: string;
}

export function getTextToAudioConfig(): Promise<TtaResult<TtaConfigAnswer>> {
  return request("/api/ai/text-to-audio/config");
}

export interface TtaQuoteView {
  characters: number;
  freeCharactersCovered: number;
  billableCharacters: number;
  perCharacterCents: number;
  qualityMultiplier: number;
  lines: { key: string; label: string; amountCents: number; characters?: number }[];
  totalCents: number;
  /** 0184: what the wallet is charged, in credits — the figure the member sees. 0 when free. */
  credits: number;
  currency: string;
  pricingConfigVersion: number;
}
export interface TtaQuoteAnswer {
  quote: TtaQuoteView;
  free: TtaFreeState & { afterThis: number };
  credits: AiCreditsView | null;
  walletFallback: "allow" | "ask" | "off";
}

export function getTextToAudioQuote(input: { text?: string; characters?: number }, signal?: AbortSignal): Promise<TtaResult<TtaQuoteAnswer>> {
  return request("/api/ai/text-to-audio/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal });
}

export function generateTextToAudio(input: {
  clientRequestId: string;
  text: string;
  name?: string;
  voiceId?: string | null;
  languageCode?: string | null;
  /** 2026-09-27: Natural / Expressive / Calm — a name, never the numbers. */
  delivery?: "natural" | "expressive" | "calm" | null;
  quote?: { totalCents: number; pricingConfigVersion: number };
  funding?: "credits" | "wallet";
  save?: boolean;
}): Promise<TtaResult<{ job: AiJobView; created: boolean; billing: "free" | "credits" | "paid" | null; balanceCents: number | null; credits: AiCreditsView | null; freeCharactersUsed: number }>> {
  return request("/api/ai/text-to-audio/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

/* ───────────────────────────── the Audio Library ────────────────────────── */

export interface AudioAssetItem {
  id: string;
  jobId: string | null;
  name: string;
  mime: string;
  bytes: number;
  durationMs: number | null;
  voiceId: string | null;
  languageCode: string | null;
  characters: number;
  createdAt: string;
}

export function listAudioLibrary(limit = 100): Promise<TtaResult<{ assets: AudioAssetItem[] }>> {
  return request(`/api/ai/audio?limit=${encodeURIComponent(String(limit))}`);
}

export async function getAudioAssetUrl(id: string): Promise<TtaResult<{ url: string; expiresIn: number; mime: string; bytes: number; durationMs: number | null }>> {
  /*
    Playing the same audio again within its link's life asks nothing (owner,
    2026-10-06) — lib/ai/media-url-cache.ts. mime/bytes/duration are what the
    player already showed; the cached hit only needs the URL.
  */
  const key = `audio:${id}`;
  const hit = cachedMediaUrl(key);
  if (hit) return { ok: true, url: hit, expiresIn: 0, mime: "", bytes: 0, durationMs: null } as TtaResult<{ url: string; expiresIn: number; mime: string; bytes: number; durationMs: number | null }>;
  const res = await request<{ url: string; expiresIn: number; mime: string; bytes: number; durationMs: number | null }>(`/api/ai/audio/${encodeURIComponent(id)}/file`);
  if (res.ok) rememberMediaUrl(key, res.url, res.expiresIn);
  return res;
}

export function renameAudioAsset(id: string, name: string): Promise<TtaResult<{ asset: AudioAssetItem }>> {
  return request(`/api/ai/audio/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
}

export function deleteAudioAsset(id: string): Promise<TtaResult<{ deleted: boolean }>> {
  return request(`/api/ai/audio/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * The download URL a browser can navigate to.
 *
 * 🔴 SAME-ORIGIN, and that is the whole point (2026-09-27). It used to carry
 * `redirect=1`, which bounced to Supabase — and a cross-origin navigation is
 * opened by the phone rather than saved, which is what the owner saw as
 * "saving audio opens as web". The route streams the bytes with an
 * `attachment` disposition instead.
 */
export function audioDownloadHref(id: string): string {
  return `/api/ai/audio/${encodeURIComponent(id)}/file?download=1`;
}
