/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI PROVIDERS — which vendor runs which feature, and its model
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (the fal.ai brief): "integrate fal.ai as a second AI
 * provider while preserving the existing Replicate integration completely …
 * allow the FrenzSave admin to switch supported AI features between Replicate
 * and fal.ai from the admin dashboard, so both providers can be compared using
 * real Frenz AI workloads."
 *
 * This module is PURE (no imports, like lib/ai/credits/config.ts): the type,
 * the defaults, the bounds, the normaliser and the feature table. It is
 * stored under ONE key of the landing settings row (`frenzAiProviders`),
 * merged on the way in and clamped on the way out. The admin form imports it
 * for its bounds and labels; the server reads it to route.
 *
 * ── The feature table is the whole restriction (§2, §9, §17) ────────────────
 *
 *   character_replace   switchable   replicate | fal      fal = Kling O1 Video Edit
 *   lip_sync            switchable   replicate | fal      fal = Sync-3
 *   text_to_speech      LOCKED       elevenlabs           ElevenLabs v3 only
 *   voice_change        LOCKED       elevenlabs           ElevenLabs only
 *
 * A locked feature's provider is not a field the normaliser reads: whatever a
 * patch says, `text_to_speech.provider` comes out "elevenlabs". fal.ai cannot
 * become a voice provider by configuration, and there is no AI Clean row —
 * that tool is retired (owner, 2026-09-20) and is not displayed anywhere.
 *
 * ── Locked models (§3) ──────────────────────────────────────────────────────
 * The fal.ai Character Replace model is Kling O1 Video Edit
 * (`fal-ai/kling-video/o1/standard/video-to-video/edit`) — NOT Wan 2.2 through
 * another door; the point is to compare model families. The fal.ai Lip Sync
 * model is Sync-3 (`fal-ai/sync-lipsync/v3`). The endpoint ids are the
 * defaults here so a later model is a configuration change, but the
 * normaliser refuses a Wan endpoint on fal.ai (it would defeat the comparison
 * the owner asked for).
 */

export type AiVendor = "replicate" | "fal" | "elevenlabs";
export type SwitchableVendor = "replicate" | "fal";
export const SWITCHABLE_VENDORS: readonly SwitchableVendor[] = ["replicate", "fal"];
export type ProviderFeature = "character_replace" | "lip_sync" | "text_to_speech" | "voice_change";
export const PROVIDER_FEATURES: readonly ProviderFeature[] = ["character_replace", "lip_sync", "text_to_speech", "voice_change"];
export type SwitchableFeature = "character_replace" | "lip_sync";
export const SWITCHABLE_FEATURES: readonly SwitchableFeature[] = ["character_replace", "lip_sync"];

export const AI_VENDOR_LABEL: Record<AiVendor, string> = { replicate: "Replicate", fal: "fal.ai", elevenlabs: "ElevenLabs" };

/** The locked fal.ai endpoints (§3). */
export const FAL_KLING_O1_EDIT = "fal-ai/kling-video/o1/standard/video-to-video/edit";
export const FAL_SYNC3 = "fal-ai/sync-lipsync/v3";

/**
 * One row per Frenz AI feature: what may run it, what is locked, what is
 * built. The "future features" the owner asked to be covered are rows here
 * the day they exist — a feature is switchable only when this table says so.
 */
export interface ProviderFeatureDef {
  id: ProviderFeature;
  label: string;
  /** The vendors an operator may choose between. One entry = locked. */
  vendors: readonly AiVendor[];
  locked: AiVendor | null;
  /** The vendor's model on each side (display; the configured model may differ for switchable ones). */
  models: Partial<Record<AiVendor, string>>;
  built: boolean;
  note: string;
}

export const PROVIDER_FEATURE_DEFS: readonly ProviderFeatureDef[] = [
  {
    id: "character_replace",
    label: "Character Replace",
    vendors: ["replicate", "fal"],
    locked: null,
    models: { replicate: "the configured model per scope (Wan 2.2 Animate Replace for Full Character / Upper Body)", fal: "Kling O1 Video Edit" },
    built: true,
    note: "Face Only · Face + Head · Upper Body · Full Character. The fal.ai model serves the scopes its capability mapping lists; the others are refused before anything is charged.",
  },
  {
    id: "lip_sync",
    label: "Lip Sync",
    vendors: ["replicate", "fal"],
    locked: null,
    models: { replicate: "Sync Labs lipsync-2 / lipsync-2-pro (per tier)", fal: "Sync-3" },
    built: true,
    note: "Audio-driven on both sides. Text becomes audio through ElevenLabs first; a lip-sync model never receives text.",
  },
  {
    id: "text_to_speech",
    label: "Text to Speech",
    vendors: ["elevenlabs"],
    locked: "elevenlabs",
    models: { elevenlabs: "ElevenLabs v3" },
    built: true,
    note: "ElevenLabs only. Not switchable.",
  },
  {
    id: "voice_change",
    label: "Voice Replace / Voice Cloning",
    vendors: ["elevenlabs"],
    locked: "elevenlabs",
    models: { elevenlabs: "ElevenLabs speech-to-speech (catalogue voices)" },
    built: true,
    note: "ElevenLabs only. Not switchable. Voice cloning of a member's own voice is not offered.",
  },
];

export function providerFeatureDef(id: ProviderFeature): ProviderFeatureDef {
  return PROVIDER_FEATURE_DEFS.find((f) => f.id === id)!;
}

/** The per-(feature, provider) model configuration (§11, §25). */
export interface ProviderModelConfig {
  /** The endpoint / model id the adapter submits to. */
  model: string;
  /** A version pin where the vendor has one (Replicate); empty = the adapter's own pin, or none (fal). */
  version: string;
  enabled: boolean;
  /** Ceilings the operator may tighten below the model's documented ones; null = the model's own. */
  maxDurationSeconds: number | null;
  maxEdgePx: number | null;
  /**
   * §18: credits are provider-independent UNLESS the operator explicitly
   * configures different economics. 1 = the same credits whoever runs it.
   */
  creditMultiplier: number;
  /** §19: the operator's cost profile for the ESTIMATE — per second of output and/or per run, US cents. 0 = unknown. */
  costUsdCentsPerSecond: number;
  costUsdCentsPerRun: number;
  /** An extra cap on runs in flight at this provider for this feature; 0 = only the member/global caps. */
  maxConcurrent: number;
  /** How long a run may sit at the provider before the stall sweep ends it; 0 = the processing default. */
  timeoutMinutes: number;
  /** Submission retries on a transient provider refusal (never on a validation error). */
  retryCount: number;
  notes: string;
}

export type ModelKey = `${SwitchableFeature}:${SwitchableVendor}`;
export const MODEL_KEYS: readonly ModelKey[] = ["character_replace:replicate", "character_replace:fal", "lip_sync:replicate", "lip_sync:fal"];

export type ReplacementScope = "face_only" | "skin_face" | "upper_body" | "full_character";

export interface AiProvidersConfig {
  features: {
    character_replace: {
      provider: SwitchableVendor;
      /**
       * §4: a scope the active provider's model cannot serve. `unavailable`
       * (default) = the scope is off while that provider is active, with a
       * clear sentence; `replicate` = the operator explicitly keeps those
       * scopes on the Replicate adapters. Never a silent re-mapping.
       */
      unsupportedScopes: "unavailable" | "replicate";
      /** The scopes the fal.ai model is allowed to serve — a subset of its capability mapping the operator may narrow after testing. */
      falScopes: Record<ReplacementScope, boolean>;
    };
    lip_sync: { provider: SwitchableVendor };
    text_to_speech: { provider: "elevenlabs" };
    voice_change: { provider: "elevenlabs" };
  };
  models: Record<ModelKey, ProviderModelConfig>;
  /** §26 emergency controls: a paused vendor accepts no NEW runs (jobs in flight finish); nothing is moved elsewhere. */
  paused: Record<SwitchableVendor, boolean>;
  /** §22: the initial implementation is the primary switch only. Kept as a field so the day a safe fallback exists it is a visible setting, off by default. */
  fallback: "off";
  /** §27: jobs created by an admin are marked TEST in the ledgers (admins are never charged anyway). */
  adminJobsAreTests: boolean;
  version: number;
  updatedAt: string | null;
}

export const AI_PROVIDERS_BOUNDS = {
  maxDurationSeconds: { min: 1, max: 600 },
  maxEdgePx: { min: 256, max: 4096 },
  creditMultiplier: { min: 0.1, max: 10 },
  costUsdCents: { min: 0, max: 100_000 },
  maxConcurrent: { min: 0, max: 100 },
  timeoutMinutes: { min: 0, max: 240 },
  retryCount: { min: 0, max: 5 },
} as const;

const model = (m: string, notes: string, extra: Partial<ProviderModelConfig> = {}): ProviderModelConfig => ({
  model: m,
  version: "",
  enabled: true,
  maxDurationSeconds: null,
  maxEdgePx: null,
  creditMultiplier: 1,
  costUsdCentsPerSecond: 0,
  costUsdCentsPerRun: 0,
  maxConcurrent: 0,
  timeoutMinutes: 0,
  retryCount: 0,
  notes,
  ...extra,
});

export const AI_PROVIDERS_DEFAULTS: AiProvidersConfig = {
  features: {
    character_replace: {
      provider: "replicate",
      unsupportedScopes: "unavailable",
      // Kling O1 Video Edit replaces the character in a video from a reference element while keeping the motion —
      // Full Character and Upper Body are that task. Face Only / Face + Head are face-swap tasks the adapter does not claim (§4).
      falScopes: { face_only: false, skin_face: false, upper_body: true, full_character: true },
    },
    lip_sync: { provider: "replicate" },
    text_to_speech: { provider: "elevenlabs" },
    voice_change: { provider: "elevenlabs" },
  },
  models: {
    "character_replace:replicate": model("per-scope (Character Replace pricing → provider model)", "The existing adapters: the model per scope is set on the Character Replace pricing tab; version pins live with the adapters."),
    "character_replace:fal": model(FAL_KLING_O1_EDIT, "Kling O1 Video Edit. Documented input: MP4/MOV, 3–10 s, 720–2160 px, ≤ 200 MB, 24–60 fps, one reference video, up to four elements/images.", { maxDurationSeconds: 10 }),
    "lip_sync:replicate": model("per-tier (Standard → sync/lipsync-2, Studio → sync/lipsync-2-pro)", "The existing Sync Labs adapters on Replicate; the model per tier is set on the Character Replace pricing tab."),
    "lip_sync:fal": model(FAL_SYNC3, "Sync-3. Input: video_url, audio_url, sync_mode. Audio-driven only — text becomes audio through ElevenLabs first."),
  },
  paused: { replicate: false, fal: false },
  fallback: "off",
  adminJobsAreTests: true,
  version: 1,
  updatedAt: null,
};

/* ───────────────────────────── the normaliser ────────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
};
const optionalInt = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const text = (v: unknown, d: string, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : d);
/** A model/endpoint id: owner/name, optional path segments and pins — nothing that could carry a URL or a script. */
const modelId = (v: unknown, d: string) => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/.test(v.trim()) ? v.trim() : d);
const vendor = (v: unknown, d: SwitchableVendor): SwitchableVendor => (v === "replicate" || v === "fal" ? v : d);

/** §3's final rule: "Do not add Wan 2.2 to fal.ai." A Wan endpoint configured on the fal side is refused. */
export function isWanEndpoint(m: string): boolean {
  return /wan/i.test(m) && /(animate|replace|2\.2|2-2)/i.test(m);
}

function normalizeModel(raw: unknown, d: ProviderModelConfig, key: ModelKey): ProviderModelConfig {
  const r = isRecord(raw) ? raw : {};
  let m = modelId(r.model, d.model);
  if (key === "character_replace:fal" && isWanEndpoint(m)) m = d.model;
  return {
    model: m,
    version: text(r.version, d.version, 120).replace(/[^A-Za-z0-9._\-]/g, ""),
    enabled: bool(r.enabled, d.enabled),
    maxDurationSeconds: r.maxDurationSeconds === undefined ? d.maxDurationSeconds : optionalInt(r.maxDurationSeconds, AI_PROVIDERS_BOUNDS.maxDurationSeconds.min, AI_PROVIDERS_BOUNDS.maxDurationSeconds.max),
    maxEdgePx: r.maxEdgePx === undefined ? d.maxEdgePx : optionalInt(r.maxEdgePx, AI_PROVIDERS_BOUNDS.maxEdgePx.min, AI_PROVIDERS_BOUNDS.maxEdgePx.max),
    creditMultiplier: num(r.creditMultiplier, d.creditMultiplier, AI_PROVIDERS_BOUNDS.creditMultiplier.min, AI_PROVIDERS_BOUNDS.creditMultiplier.max),
    costUsdCentsPerSecond: num(r.costUsdCentsPerSecond, d.costUsdCentsPerSecond, AI_PROVIDERS_BOUNDS.costUsdCents.min, AI_PROVIDERS_BOUNDS.costUsdCents.max),
    costUsdCentsPerRun: num(r.costUsdCentsPerRun, d.costUsdCentsPerRun, AI_PROVIDERS_BOUNDS.costUsdCents.min, AI_PROVIDERS_BOUNDS.costUsdCents.max),
    maxConcurrent: int(r.maxConcurrent, d.maxConcurrent, AI_PROVIDERS_BOUNDS.maxConcurrent.min, AI_PROVIDERS_BOUNDS.maxConcurrent.max),
    timeoutMinutes: int(r.timeoutMinutes, d.timeoutMinutes, AI_PROVIDERS_BOUNDS.timeoutMinutes.min, AI_PROVIDERS_BOUNDS.timeoutMinutes.max),
    retryCount: int(r.retryCount, d.retryCount, AI_PROVIDERS_BOUNDS.retryCount.min, AI_PROVIDERS_BOUNDS.retryCount.max),
    notes: text(r.notes, d.notes, 400),
  };
}

export function normalizeAiProvidersConfig(raw: unknown): AiProvidersConfig {
  const d = AI_PROVIDERS_DEFAULTS;
  if (!isRecord(raw)) return d;
  const features = isRecord(raw.features) ? raw.features : {};
  const cr = isRecord(features.character_replace) ? features.character_replace : {};
  const ls = isRecord(features.lip_sync) ? features.lip_sync : {};
  const models = isRecord(raw.models) ? raw.models : {};
  const paused = isRecord(raw.paused) ? raw.paused : {};
  const scopes = isRecord(cr.falScopes) ? cr.falScopes : {};
  return {
    features: {
      character_replace: {
        provider: vendor(cr.provider, d.features.character_replace.provider),
        unsupportedScopes: cr.unsupportedScopes === "replicate" ? "replicate" : "unavailable",
        falScopes: {
          // 🔴 the two face-swap scopes are not in the Kling adapter's capability mapping — a patch cannot switch them on (§4)
          face_only: false,
          skin_face: false,
          upper_body: bool(scopes.upper_body, d.features.character_replace.falScopes.upper_body),
          full_character: bool(scopes.full_character, d.features.character_replace.falScopes.full_character),
        },
      },
      lip_sync: { provider: vendor(ls.provider, d.features.lip_sync.provider) },
      // 🔴 LOCKED (§17): whatever the patch says, the voice features are ElevenLabs.
      text_to_speech: { provider: "elevenlabs" },
      voice_change: { provider: "elevenlabs" },
    },
    models: Object.fromEntries(MODEL_KEYS.map((k) => [k, normalizeModel(models[k], d.models[k], k)])) as Record<ModelKey, ProviderModelConfig>,
    paused: { replicate: bool(paused.replicate, false), fal: bool(paused.fal, false) },
    fallback: "off",
    adminJobsAreTests: bool(raw.adminJobsAreTests, d.adminJobsAreTests),
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/** The fields whose change alters WHERE a new job runs or what it is estimated to cost — a change bumps `version`. */
export function aiProvidersFingerprint(c: AiProvidersConfig): string {
  // notes are the operator's own words — not a route, not a cost
  const models = Object.fromEntries(MODEL_KEYS.map((k) => [k, { ...c.models[k], notes: undefined }]));
  return JSON.stringify({ features: c.features, models, paused: c.paused, fallback: c.fallback });
}

export function versionAiProviders(previous: AiProvidersConfig, next: AiProvidersConfig, now: Date = new Date()): AiProvidersConfig {
  if (aiProvidersFingerprint(previous) === aiProvidersFingerprint(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/** The vendor configured for a feature — locked ones answer their lock whatever is stored. */
export function configuredVendor(c: AiProvidersConfig, feature: ProviderFeature): AiVendor {
  const def = providerFeatureDef(feature);
  if (def.locked) return def.locked;
  return feature === "character_replace" ? c.features.character_replace.provider : c.features.lip_sync.provider;
}

export function modelConfigFor(c: AiProvidersConfig, feature: SwitchableFeature, v: SwitchableVendor): ProviderModelConfig {
  return c.models[`${feature}:${v}`];
}

/** §19: the operator's estimate for one run at a provider — seconds × per-second + per-run, in US cents; null = unknown. */
export function providerRunEstimateUsdCents(m: ProviderModelConfig, durationMs: number): number | null {
  const perSecond = m.costUsdCentsPerSecond > 0 && durationMs > 0 ? (durationMs / 1000) * m.costUsdCentsPerSecond : 0;
  const total = perSecond + (m.costUsdCentsPerRun > 0 ? m.costUsdCentsPerRun : 0);
  return total > 0 ? Math.round(total * 100) / 100 : null;
}
