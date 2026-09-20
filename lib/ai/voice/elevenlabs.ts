import "server-only";

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
}

/** Pure, exposed for tests: exactly what the API is sent. */
export function buildElevenLabsTtsBody(req: { text: string; modelId: string; languageCode: string | null; languageCodeParam: boolean }): ElevenLabsTtsInput {
  const body: ElevenLabsTtsInput = { text: req.text, model_id: req.modelId };
  // v3 and Multilingual v2 refuse the parameter; Turbo/Flash v2.5 take it.
  if (req.languageCodeParam && req.languageCode) body.language_code = req.languageCode.toLowerCase();
  return body;
}

export async function elevenLabsTextToSpeech(req: { text: string; modelId: string; providerVoiceId: string; languageCode: string | null; languageCodeParam: boolean }): Promise<{ bytes: Buffer; mime: "audio/mpeg" }> {
  const voice = encodeURIComponent(req.providerVoiceId);
  const res = await call(
    `/text-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`,
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(buildElevenLabsTtsBody(req)) },
    "text-to-speech",
  );
  return { bytes: await readBody(res), mime: "audio/mpeg" };
}

/* ───────────────────────────── speech → speech ───────────────────────────── */

export async function elevenLabsSpeechToSpeech(req: { audio: Buffer; filename: string; audioMime: string; modelId: string; providerVoiceId: string }): Promise<{ bytes: Buffer; mime: "audio/mpeg" }> {
  const voice = encodeURIComponent(req.providerVoiceId);
  const form = new FormData();
  form.set("model_id", req.modelId);
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
