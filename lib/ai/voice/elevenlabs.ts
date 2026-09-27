import "server-only";

import { clampVoiceSettings, type ClampedVoiceSettings, type TtsVoiceSettings } from "@/lib/ai/voice/voice-settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELEVENLABS — the HTTP client. Text → speech, speech → speech, the voice list
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A plain `fetch` client, no SDK (standing rule: no unnecessary dependency).
 * Three calls, each synchronous — the audio comes back in the response body,
 * which is why the worker runs them (server/services/ai-character-replace-
 * prepare-service.ts) and not a Vercel function: a long dialogue or a
 * 60-second voice change takes tens of seconds, and the worker has no clock
 * on it.
 *
 * ── The key ─────────────────────────────────────────────────────────────────
 * `ELEVENLABS_API_KEY`, on Railway (the worker synthesises and converts) AND
 * on Vercel (the admin imports the voice list). Never logged, never in an
 * error, never in a response.
 *
 * ── Errors ──────────────────────────────────────────────────────────────────
 * Mapped to a KIND the caller can act on, never the provider's sentence:
 *   auth      the key is missing, wrong or the plan refuses the model → the
 *             feature is unavailable; the operator's problem, said loudly
 *   input     the provider refused what was sent (too long, unknown voice,
 *             an unsupported language) → the job ends AUDIO_INVALID, refunded
 *   rate      429 → retried once, then transient
 *   provider  5xx / an unreadable answer → transient
 *   network   → transient
 * The provider's own message is kept on the error for the worker's log and
 * the audit event (truncated), never for a member.
 */

const BASE = "https://api.elevenlabs.io/v1";
/** The worker re-encodes whatever comes back to WAV; MP3 at 128 kb/s is the format every plan may ask for. */
const OUTPUT_FORMAT = "mp3_44100_128";
/** No dialogue or clip this product accepts produces more than this. */
const MAX_RESPONSE_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 180_000;

export type ElevenLabsErrorKind = "auth" | "input" | "rate" | "provider" | "network";

export class ElevenLabsError extends Error {
  constructor(
    public readonly kind: ElevenLabsErrorKind,
    public readonly status: number | null,
    detail: string,
  ) {
    super(`elevenlabs ${kind}${status ? ` ${status}` : ""}: ${detail.slice(0, 300)}`);
    this.name = "ElevenLabsError";
  }
  /** Whether another attempt could succeed without anyone changing anything. */
  get transient(): boolean {
    return this.kind === "rate" || this.kind === "provider" || this.kind === "network";
  }
}

export function elevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY?.trim();
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new ElevenLabsError("auth", null, "ELEVENLABS_API_KEY is not set");
  return key;
}

/** Read the provider's error sentence out of a failed answer, for the log — never for a member. */
async function failureDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { detail?: unknown };
      const d = json.detail;
      if (typeof d === "string") return d;
      if (d && typeof d === "object") {
        const m = (d as { message?: unknown; status?: unknown }).message ?? (d as { status?: unknown }).status;
        if (typeof m === "string") return m;
      }
    } catch {
      /* not JSON */
    }
    return text.slice(0, 300);
  } catch {
    return "(unreadable)";
  }
}

function classify(status: number): ElevenLabsErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status >= 500) return "provider";
  return "input";
}

async function readBody(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new ElevenLabsError("provider", res.status, `answer of ${declared} bytes is over the ceiling`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_RESPONSE_BYTES) throw new ElevenLabsError("provider", res.status, `answer of ${buf.byteLength} bytes is over the ceiling`);
  return buf;
}

/**
 * One call, with one retry on a rate limit or a 5xx. `init.body` must be
 * re-sendable (a string or a FormData, both are).
 */
async function call(path: string, init: RequestInit & { headers?: Record<string, string> }, label: string): Promise<Response> {
  const key = apiKey();
  let last: ElevenLabsError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_500));
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...init.headers, "xi-api-key": key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      last = new ElevenLabsError("network", null, `${label}: ${String(e)}`);
      continue;
    }
    if (res.ok) return res;
    const kind = classify(res.status);
    const err = new ElevenLabsError(kind, res.status, `${label}: ${await failureDetail(res)}`);
    if (kind === "rate" || kind === "provider") {
      last = err;
      continue;
    }
    throw err;
  }
  throw last ?? new ElevenLabsError("provider", null, `${label}: no answer`);
}

/* ───────────────────────────── text → speech ─────────────────────────────── */

export interface ElevenLabsTtsInput {
  text: string;
  model_id: string;
  language_code?: string;
  /**
   * 🔴 ADDED 2026-09-27, and the reason the voice sounded like a reading.
   *
   * Owner: "i test the text to speech now and i think is not realistic
   * enough, sounds like ai." The model was v3 all along; THIS FIELD WAS
   * ABSENT, so every generation ran at the provider's conservative defaults
   * with the expressiveness dial (`style`) at ZERO — a perfect model reading
   * a sentence the way a screen reader does. lib/ai/voice/voice-settings.ts
   * owns the numbers and knows what each model actually reads;
   * `clampVoiceSettings` DROPS a field the model does not take rather than
   * sending one it would refuse (v3's stability is a choice of three).
   */
  voice_settings?: ClampedVoiceSettings;
}

/** Pure, exposed for tests: exactly what the API is sent. */
export function buildElevenLabsTtsBody(req: { text: string; modelId: string; languageCode: string | null; languageCodeParam: boolean; voiceSettings?: TtsVoiceSettings | null }): ElevenLabsTtsInput {
  const body: ElevenLabsTtsInput = { text: req.text, model_id: req.modelId };
  // v3 and Multilingual v2 refuse the parameter; Turbo/Flash v2.5 take it.
  if (req.languageCodeParam && req.languageCode) body.language_code = req.languageCode.toLowerCase();
  if (req.voiceSettings) body.voice_settings = clampVoiceSettings(req.voiceSettings, req.modelId);
  return body;
}

export async function elevenLabsTextToSpeech(req: { text: string; modelId: string; providerVoiceId: string; languageCode: string | null; languageCodeParam: boolean; voiceSettings?: TtsVoiceSettings | null }): Promise<{ bytes: Buffer; mime: "audio/mpeg" }> {
  const voice = encodeURIComponent(req.providerVoiceId);
  const res = await call(
    `/text-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`,
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(buildElevenLabsTtsBody(req)) },
    "text-to-speech",
  );
  return { bytes: await readBody(res), mime: "audio/mpeg" };
}

/* ───────────────────────────── speech → speech ───────────────────────────── */

export async function elevenLabsSpeechToSpeech(req: { audio: Buffer; filename: string; audioMime: string; modelId: string; providerVoiceId: string; voiceSettings?: TtsVoiceSettings | null }): Promise<{ bytes: Buffer; mime: "audio/mpeg" }> {
  const voice = encodeURIComponent(req.providerVoiceId);
  const form = new FormData();
  form.set("model_id", req.modelId);
  // the voice changer reads the same dials (2026-09-27). Multipart, so the object goes as a JSON string.
  if (req.voiceSettings) form.set("voice_settings", JSON.stringify(clampVoiceSettings(req.voiceSettings, req.modelId)));
  form.set("audio", new Blob([new Uint8Array(req.audio)], { type: req.audioMime }), req.filename);
  const res = await call(`/speech-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`, { method: "POST", headers: { Accept: "audio/mpeg" }, body: form }, "speech-to-speech");
  return { bytes: await readBody(res), mime: "audio/mpeg" };
}

/* ───────────────────────────── the account's voices ──────────────────────── */

export interface ElevenLabsVoiceRow {
  voiceId: string;
  name: string;
  /** "premade" for the provider's library, "cloned" / "generated" / "professional" for the account's own. */
  category: string;
  description: string;
  labels: Record<string, string>;
}

export async function elevenLabsListVoices(): Promise<ElevenLabsVoiceRow[]> {
  const res = await call("/voices", { method: "GET", headers: { Accept: "application/json" } }, "voices");
  const json = (await res.json()) as { voices?: unknown };
  if (!Array.isArray(json.voices)) throw new ElevenLabsError("provider", res.status, "voices: no list in the answer");
  const out: ElevenLabsVoiceRow[] = [];
  for (const v of json.voices) {
    if (!v || typeof v !== "object") continue;
    const r = v as { voice_id?: unknown; name?: unknown; category?: unknown; description?: unknown; labels?: unknown };
    if (typeof r.voice_id !== "string" || typeof r.name !== "string") continue;
    const labels: Record<string, string> = {};
    if (r.labels && typeof r.labels === "object") for (const [k, val] of Object.entries(r.labels as Record<string, unknown>)) if (typeof val === "string") labels[k] = val;
    out.push({ voiceId: r.voice_id, name: r.name, category: typeof r.category === "string" ? r.category : "", description: typeof r.description === "string" ? r.description : "", labels });
  }
  return out;
}

/* ───────────────────────────── voice cloning (2026-09-27) ────────────────── */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADD, EDIT AND REMOVE A VOICE — instant voice cloning
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "next lets build the standalone voice cloning." This
 * REVERSES a standing rule written in this file's neighbours — voice cloning
 * used to be "not a workflow this product has" (lib/ai/voice/tts-provider.ts
 * §6). It is one now, and it is a product of its own with its own consent
 * record (lib/ai/voice-clone/*).
 *
 * `POST /v1/voices/add` is multipart: a name, some labels, and one `files`
 * part per sample. It answers with a `voice_id` — and that id is the whole
 * point, because from then on it is just another voice the text-to-speech and
 * voice-changer calls above can be pointed at.
 *
 * ── 🔴 A SLOT IS OCCUPIED UNTIL SOMETHING DELETES IT ────────────────────────
 * Every clone holds a voice slot on OUR account, shared by every member. That
 * is why `elevenLabsDeleteVoice` exists and why the delete path calls it before
 * it touches our own row: a soft-deleted row with a live provider voice behind
 * it is a slot nobody can ever reclaim, and slots are what run out.
 */
export interface ElevenLabsClonedVoice {
  voiceId: string;
  name: string;
  /** The provider's own preview, when it returns one. Not relied upon: the member's first sample is our preview. */
  previewUrl: string | null;
}

export interface ElevenLabsVoiceSample {
  bytes: Buffer;
  filename: string;
  mime: string;
}

export async function elevenLabsAddVoice(req: { name: string; description: string; samples: readonly ElevenLabsVoiceSample[]; labels?: Record<string, string> }): Promise<ElevenLabsClonedVoice> {
  if (req.samples.length === 0) throw new ElevenLabsError("input", null, "add-voice: no samples");
  const form = new FormData();
  form.set("name", req.name.slice(0, 100));
  if (req.description.trim()) form.set("description", req.description.trim().slice(0, 500));
  if (req.labels && Object.keys(req.labels).length > 0) form.set("labels", JSON.stringify(req.labels));
  // one `files` part per sample — the API reads them as one voice, not as several
  for (const s of req.samples) form.append("files", new Blob([new Uint8Array(s.bytes)], { type: s.mime }), s.filename);
  const res = await call("/voices/add", { method: "POST", headers: { Accept: "application/json" }, body: form }, "add-voice");
  const json = (await res.json()) as { voice_id?: unknown; name?: unknown; preview_url?: unknown; requires_verification?: unknown };
  if (typeof json.voice_id !== "string" || !json.voice_id) throw new ElevenLabsError("provider", res.status, "add-voice: no voice_id in the answer");
  return {
    voiceId: json.voice_id,
    name: typeof json.name === "string" && json.name ? json.name : req.name,
    previewUrl: typeof json.preview_url === "string" && json.preview_url ? json.preview_url : null,
  };
}

/**
 * Rename a clone at the provider, so the account stays readable to whoever
 * looks after it. Best-effort by design: our row is the name the member sees,
 * and a failure here must never make a rename fail for them.
 */
export async function elevenLabsEditVoice(req: { voiceId: string; name: string; description: string }): Promise<void> {
  const form = new FormData();
  form.set("name", req.name.slice(0, 100));
  if (req.description.trim()) form.set("description", req.description.trim().slice(0, 500));
  await call(`/voices/${encodeURIComponent(req.voiceId)}/edit`, { method: "POST", headers: { Accept: "application/json" }, body: form }, "edit-voice");
}

/**
 * Remove a clone and free its slot. A 404 is SUCCESS: the voice is already
 * gone, which is the state the caller wanted, and treating it as a failure
 * would strand our row for ever behind a provider object that does not exist.
 */
export async function elevenLabsDeleteVoice(voiceId: string): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  try {
    await call(`/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { Accept: "application/json" } }, "delete-voice");
    return { deleted: true, alreadyGone: false };
  } catch (e) {
    if (e instanceof ElevenLabsError && e.status === 404) return { deleted: true, alreadyGone: true };
    throw e;
  }
}
