import type { AiCreditsView } from "@/lib/ai/wallet/client";
import type { AiJobView } from "@/lib/ai/jobs";
import type { VoiceClonePublicConfig } from "@/lib/ai/voice-clone/config";

/**
 * The browser's view of Voice Cloning and the Voice Library. Same shape as the
 * other tools' clients: one `request` helper, every answer a discriminated
 * result, no throwing. Nothing here knows a provider, a model or a voice id
 * that is not ours.
 */
export type VcResult<T> = ({ ok: true } & T) | { ok: false; code: string; error: string; extra?: Record<string, unknown> };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<VcResult<T>> {
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

export interface VcFreeState {
  allowance: number;
  used: number;
  remaining: number;
  monthKey: string;
}

export interface VcQuoteView {
  freeCovered: boolean;
  perCloneCents: number;
  lines: { key: string; label: string; amountCents: number }[];
  totalCents: number;
  /** 0184: what the wallet is charged, in credits — the figure the member sees. 0 when free. */
  credits: number;
  currency: string;
  pricingConfigVersion: number;
}

export interface VcConfigAnswer {
  config: VoiceClonePublicConfig;
  free: VcFreeState;
  quote: VcQuoteView;
  credits: AiCreditsView | null;
  walletFallback: "allow" | "ask" | "off";
  /** How many voices this member already holds, against their ceiling. */
  slots: { used: number; total: number };
  available: boolean;
  unavailableReason: string | null;
  audience: string;
}

export function getVoiceCloneConfig(): Promise<VcResult<VcConfigAnswer>> {
  return request("/api/ai/voice-clones/config");
}

export interface VcUploadTicket {
  index: number;
  path: string;
  uploadUrl: string;
  expiresIn: number;
}

export function createVoiceCloneDraft(input: {
  clientRequestId: string;
  name: string;
  description?: string;
  samples: { name: string; mimeType: string; size: number; durationMs?: number | null }[];
  labels?: { language?: string | null; accent?: string | null; gender?: string | null; age?: string | null };
}): Promise<VcResult<{ job: AiJobView; created: boolean; uploads: VcUploadTicket[] }>> {
  return request("/api/ai/voice-clones/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

/**
 * One sample, straight into our private bucket. The bytes never touch a
 * function of ours — same as every other upload in this product.
 */
export async function uploadVoiceSample(ticket: VcUploadTicket, file: File, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(ticket.uploadUrl, {
      method: "PUT",
      // `x-upsert` so a retry after a half-finished upload overwrites the member's own object rather than answering 409
      headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" },
      body: file,
      signal,
    });
    if (!res.ok) return { ok: false, error: "That recording couldn't be saved. Try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "That recording couldn't be saved. Check your connection and try again." };
  }
}

export function startVoiceClone(
  jobId: string,
  input: { consent: true; consentName?: string; quote?: { totalCents: number; pricingConfigVersion: number }; funding?: "credits" | "wallet" },
): Promise<VcResult<{ job: AiJobView; billing: "free" | "credits" | "paid" | null; balanceCents: number | null; credits: AiCreditsView | null }>> {
  return request(`/api/ai/voice-clones/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

/* ───────────────────────────── the Voice Library ─────────────────────────── */

export interface VoiceCloneItem {
  id: string;
  jobId: string | null;
  name: string;
  description: string;
  status: "pending" | "ready" | "failed" | "deleted";
  sampleCount: number;
  sampleSeconds: number | null;
  hasPreview: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  consentAt: string;
  describedAs: string;
}

export function listVoiceCloneLibrary(): Promise<VcResult<{ voices: VoiceCloneItem[]; slots: { used: number; total: number } }>> {
  return request("/api/ai/voice-clones");
}

export function getVoiceSampleUrl(id: string): Promise<VcResult<{ url: string; expiresIn: number; mime: string }>> {
  return request(`/api/ai/voice-clones/${encodeURIComponent(id)}/sample`);
}

export function renameVoiceCloneItem(id: string, name: string, description?: string): Promise<VcResult<{ voice: VoiceCloneItem }>> {
  return request(`/api/ai/voice-clones/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(description === undefined ? {} : { description }) }) });
}

export function deleteVoiceCloneItem(id: string): Promise<VcResult<{ deleted: boolean }>> {
  return request(`/api/ai/voice-clones/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Read an audio file's length in the browser, for the "how much have I given
 * you" hint and the too-short check. Resolves null when the browser cannot
 * decode it — the server never depends on this number.
 */
export function measureAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    const done = (ms: number | null) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(ms);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null);
    el.onerror = () => done(null);
    // a file the browser hangs on must not hang the picker
    window.setTimeout(() => done(null), 8000);
    el.src = url;
  });
}
