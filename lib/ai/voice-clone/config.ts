/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING — the operator's configuration (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "next lets build the standalone voice cloning … all ai
 * features pipeline must be standalone to give a cleaner premium result rather
 * than making them all go through same pipeline."
 *
 * Stored under ONE key of the landing settings row (`frenzAiVoiceClone`), like
 * every other tool's configuration.
 *
 * ── 🟢 ONE VENDOR, AND IT IS NOT A VIDEO ONE ────────────────────────────────
 * The clone is made by the DIRECT ElevenLabs API (`/v1/voices/add`). There is
 * no route switch here on purpose: 2026-09-27 the owner stopped all new work on
 * Replicate and fal.ai, and the direct ElevenLabs path is the audio path. A
 * deployment without `ELEVENLABS_API_KEY` reports the tool unavailable rather
 * than offering it and failing at the end.
 *
 * ── 🔴 SLOTS ARE THE SCARCE THING, NOT COMPUTE ──────────────────────────────
 * A clone costs the provider almost nothing to make and then occupies a VOICE
 * SLOT on our account for as long as it exists. That is what runs out, and it
 * runs out for everybody at once. So the operator holds two ceilings:
 *
 *   slots[audience]   how many live voices ONE member may keep
 *   accountVoiceCap   how many live voices ALL members may hold together
 *
 * Both are counted from the live rows of `ai_voice_clones` at start, and the
 * account cap is checked before the member's own so the sentence a member reads
 * is the true reason.
 */
export type VoiceCloneAudience = "free" | "pro" | "business" | "admin";
export const VOICE_CLONE_AUDIENCES: readonly VoiceCloneAudience[] = ["free", "pro", "business", "admin"];

/** The sample formats a member may upload. ElevenLabs accepts all of these; we only ever pass the bytes through. */
export interface VoiceCloneFormat {
  id: string;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
}
export const VOICE_CLONE_SAMPLE_FORMATS: readonly VoiceCloneFormat[] = [
  { id: "mp3", label: "MP3", extensions: ["mp3"], mimeTypes: ["audio/mpeg", "audio/mp3"] },
  { id: "wav", label: "WAV", extensions: ["wav"], mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"] },
  /*
    🔴 NO "mp4" EXTENSION. An audio-only MP4 exists and is accepted — by its
    MIME type, `audio/mp4`. Listing the EXTENSION would have let clip.mp4
    (a video, `video/mp4`) through as a voice sample, which a test caught
    on 2026-09-27 before this shipped. An extension match is a fallback for a
    file whose type the browser could not name; it must not out-vote a type the
    browser named perfectly well.
  */
  { id: "m4a", label: "M4A", extensions: ["m4a"], mimeTypes: ["audio/mp4", "audio/m4a", "audio/x-m4a"] },
  { id: "webm", label: "WebM", extensions: ["webm"], mimeTypes: ["audio/webm"] },
  { id: "ogg", label: "OGG", extensions: ["ogg", "oga"], mimeTypes: ["audio/ogg", "audio/vorbis"] },
  { id: "flac", label: "FLAC", extensions: ["flac"], mimeTypes: ["audio/flac", "audio/x-flac"] },
];

export interface VoiceCloneConfig {
  enabled: boolean;
  /** The provider's model for instant cloning. One value today; a field so the admin can move it without a deploy. */
  model: string;
  /** What a member pays for one clone, in minor units of the AI currency. */
  perCloneCents: number;
  /** The least any paid clone costs (a floor under a discounted price). */
  minimumChargeCents: number;
  /** The operator's own cost figure, US cents per clone (0 = unknown). */
  providerCostPerCloneUsdCents: number;
  creditMultiplier: number;
  /** Free voices a month, for free members AND every plan. 0 = none. */
  freeClonesPerMonth: number;
  /** How many LIVE voices one member may keep, by audience. */
  slots: Record<VoiceCloneAudience, number>;
  /** How many live voices every member together may hold — the provider account's own voice limit, minus headroom. */
  accountVoiceCap: number;
  samples: {
    minimum: number;
    maximum: number;
    /** Per file. */
    maximumBytes: number;
    /** All the files of one clone together. */
    maximumTotalBytes: number;
    /** Advisory, browser-measured: the interface refuses obviously useless input before an upload. */
    minimumSecondsTotal: number;
    maximumSecondsEach: number;
    formats: readonly string[];
  };
  /** How long the member's uploaded samples are kept after the voice is made; 0 = as long as the voice lives. */
  sampleRetentionDays: number;
  /** The words the member confirms. Stored on every clone exactly as it was shown. */
  consentStatement: string;
  /** Whether the member must type their own name as the signature (the operator's call; on by default). */
  requireConsentName: boolean;
  pricingVersion: number;
  pricingUpdatedAt: string | null;
  version: number;
  updatedAt: string | null;
}

export const VOICE_CLONE_BOUNDS = {
  cents: { min: 0, max: 100_000_000 },
  providerCostUsdCents: { min: 0, max: 100_000 },
  multiplier: { min: 0.1, max: 10 },
  freeClones: { min: 0, max: 1000 },
  slots: { min: 0, max: 500 },
  accountCap: { min: 0, max: 100_000 },
  sampleCount: { min: 1, max: 25 },
  sampleBytes: { min: 64 * 1024, max: 50 * 1024 * 1024 },
  totalBytes: { min: 64 * 1024, max: 200 * 1024 * 1024 },
  seconds: { min: 1, max: 3600 },
  retentionDays: { min: 0, max: 3650 },
} as const;

/**
 * The default consent wording. It names the two lawful cases and nothing else,
 * and it is stored per clone so a later change to this sentence never rewrites
 * what somebody already agreed to.
 */
export const VOICE_CLONE_CONSENT_STATEMENT =
  "This is my own voice, or I have the speaker's explicit permission to clone it. I will not use it to impersonate anyone or to mislead.";

export const VOICE_CLONE_DEFAULTS: VoiceCloneConfig = {
  enabled: true,
  model: "eleven_multilingual_sts_v2",
  perCloneCents: 0,
  minimumChargeCents: 0,
  providerCostPerCloneUsdCents: 0,
  creditMultiplier: 1,
  freeClonesPerMonth: 1,
  slots: { free: 1, pro: 3, business: 10, admin: 25 },
  accountVoiceCap: 100,
  samples: {
    minimum: 1,
    maximum: 5,
    maximumBytes: 15 * 1024 * 1024,
    maximumTotalBytes: 40 * 1024 * 1024,
    minimumSecondsTotal: 10,
    maximumSecondsEach: 300,
    formats: ["mp3", "wav", "m4a", "webm", "ogg", "flac"],
  },
  sampleRetentionDays: 0,
  consentStatement: VOICE_CLONE_CONSENT_STATEMENT,
  requireConsentName: true,
  pricingVersion: 1,
  pricingUpdatedAt: null,
  version: 1,
  updatedAt: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, min: number, max: number, round = false) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : Math.round(c * 1000) / 1000;
};
const int = (v: unknown, d: number, min: number, max: number) => num(v, d, min, max, true);
const text = (v: unknown, d: string, max: number) => {
  if (typeof v !== "string") return d;
  const t = v.trim().slice(0, max);
  return t || d;
};
const formats = (v: unknown, d: readonly string[]): string[] => {
  if (!Array.isArray(v)) return [...d];
  const known = new Set(VOICE_CLONE_SAMPLE_FORMATS.map((f) => f.id));
  const out = v.filter((x): x is string => typeof x === "string" && known.has(x.trim().toLowerCase())).map((x) => x.trim().toLowerCase());
  // never an empty list: a tool that accepts no format is a tool nobody can use, and an empty array here would be read as "all"
  return out.length ? [...new Set(out)] : [...d];
};

function normalizeSlots(raw: unknown, d: VoiceCloneConfig["slots"]): VoiceCloneConfig["slots"] {
  const r = isRecord(raw) ? raw : {};
  const out = { ...d };
  for (const a of VOICE_CLONE_AUDIENCES) out[a] = int(r[a], d[a], VOICE_CLONE_BOUNDS.slots.min, VOICE_CLONE_BOUNDS.slots.max);
  return out;
}

export function normalizeVoiceCloneConfig(raw: unknown): VoiceCloneConfig {
  const d = VOICE_CLONE_DEFAULTS;
  if (!isRecord(raw)) return d;
  const s = isRecord(raw.samples) ? raw.samples : {};
  const minimum = int(s.minimum, d.samples.minimum, VOICE_CLONE_BOUNDS.sampleCount.min, VOICE_CLONE_BOUNDS.sampleCount.max);
  const maximumBytes = int(s.maximumBytes, d.samples.maximumBytes, VOICE_CLONE_BOUNDS.sampleBytes.min, VOICE_CLONE_BOUNDS.sampleBytes.max);
  return {
    enabled: bool(raw.enabled, d.enabled),
    model: text(raw.model, d.model, 120),
    perCloneCents: int(raw.perCloneCents, d.perCloneCents, VOICE_CLONE_BOUNDS.cents.min, VOICE_CLONE_BOUNDS.cents.max),
    minimumChargeCents: int(raw.minimumChargeCents, d.minimumChargeCents, VOICE_CLONE_BOUNDS.cents.min, VOICE_CLONE_BOUNDS.cents.max),
    providerCostPerCloneUsdCents: num(raw.providerCostPerCloneUsdCents, d.providerCostPerCloneUsdCents, VOICE_CLONE_BOUNDS.providerCostUsdCents.min, VOICE_CLONE_BOUNDS.providerCostUsdCents.max),
    creditMultiplier: num(raw.creditMultiplier, d.creditMultiplier, VOICE_CLONE_BOUNDS.multiplier.min, VOICE_CLONE_BOUNDS.multiplier.max),
    freeClonesPerMonth: int(raw.freeClonesPerMonth, d.freeClonesPerMonth, VOICE_CLONE_BOUNDS.freeClones.min, VOICE_CLONE_BOUNDS.freeClones.max),
    slots: normalizeSlots(raw.slots, d.slots),
    accountVoiceCap: int(raw.accountVoiceCap, d.accountVoiceCap, VOICE_CLONE_BOUNDS.accountCap.min, VOICE_CLONE_BOUNDS.accountCap.max),
    samples: {
      minimum,
      // the maximum can never sit below the minimum — a pair of fields saved in either order still describes a usable tool
      maximum: Math.max(minimum, int(s.maximum, d.samples.maximum, VOICE_CLONE_BOUNDS.sampleCount.min, VOICE_CLONE_BOUNDS.sampleCount.max)),
      maximumBytes,
      maximumTotalBytes: Math.max(maximumBytes, int(s.maximumTotalBytes, d.samples.maximumTotalBytes, VOICE_CLONE_BOUNDS.totalBytes.min, VOICE_CLONE_BOUNDS.totalBytes.max)),
      minimumSecondsTotal: int(s.minimumSecondsTotal, d.samples.minimumSecondsTotal, VOICE_CLONE_BOUNDS.seconds.min, VOICE_CLONE_BOUNDS.seconds.max),
      maximumSecondsEach: int(s.maximumSecondsEach, d.samples.maximumSecondsEach, VOICE_CLONE_BOUNDS.seconds.min, VOICE_CLONE_BOUNDS.seconds.max),
      formats: formats(s.formats, d.samples.formats),
    },
    sampleRetentionDays: int(raw.sampleRetentionDays, d.sampleRetentionDays, VOICE_CLONE_BOUNDS.retentionDays.min, VOICE_CLONE_BOUNDS.retentionDays.max),
    consentStatement: text(raw.consentStatement, d.consentStatement, 600),
    requireConsentName: bool(raw.requireConsentName, d.requireConsentName),
    pricingVersion: int(raw.pricingVersion, d.pricingVersion, 1, 1_000_000_000),
    pricingUpdatedAt: typeof raw.pricingUpdatedAt === "string" ? raw.pricingUpdatedAt : null,
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val as Record<string, unknown>).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));

export function voiceClonePricingFingerprint(c: VoiceCloneConfig): string {
  return stable({ per: c.perCloneCents, minimum: c.minimumChargeCents, credits: c.creditMultiplier, free: c.freeClonesPerMonth });
}
export function voiceCloneFingerprint(c: VoiceCloneConfig): string {
  return stable({ enabled: c.enabled, model: c.model, slots: c.slots, cap: c.accountVoiceCap, samples: c.samples, retention: c.sampleRetentionDays, consent: [c.consentStatement, c.requireConsentName] });
}
export function versionVoiceCloneConfig(previous: VoiceCloneConfig, next: VoiceCloneConfig, now: Date = new Date()): VoiceCloneConfig {
  const priced = voiceClonePricingFingerprint(previous) !== voiceClonePricingFingerprint(next);
  const changed = priced || voiceCloneFingerprint(previous) !== voiceCloneFingerprint(next);
  return {
    ...next,
    pricingVersion: priced ? previous.pricingVersion + 1 : previous.pricingVersion,
    pricingUpdatedAt: priced ? now.toISOString() : previous.pricingUpdatedAt,
    version: changed ? previous.version + 1 : previous.version,
    updatedAt: changed ? now.toISOString() : previous.updatedAt,
  };
}

/** How many live voices this member may keep. An admin gets the admin row, whatever their plan says. */
export function voiceCloneSlotsFor(c: VoiceCloneConfig, opts: { audience: string; isAdmin: boolean }): number {
  if (opts.isAdmin) return c.slots.admin;
  const a = opts.audience === "pro" ? "pro" : opts.audience === "business" ? "business" : "free";
  return c.slots[a];
}

/** Whether a sample's type or extension is one the operator accepts. Pure, and the only place the two lists meet. */
export function voiceCloneFormatAllowed(c: VoiceCloneConfig, file: { name: string; mimeType: string }): boolean {
  const type = file.mimeType.toLowerCase().split(";")[0]!.trim();
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  // a type the browser named as video is refused outright, whatever the extension says
  if (type.startsWith("video/") || type.startsWith("image/")) return false;
  return VOICE_CLONE_SAMPLE_FORMATS.filter((f) => c.samples.formats.includes(f.id)).some((f) => f.mimeTypes.includes(type) || f.extensions.includes(ext));
}

export interface VoiceClonePublicConfig {
  enabled: boolean;
  currency: string;
  symbol: string;
  /** "Your first voice each month is free, then ₦500 a voice" — a sentence, server-formatted. */
  priceLine: string | null;
  perCloneCents: number;
  freeClonesPerMonth: number;
  /** This member's ceiling, already resolved for their audience. */
  slots: number;
  samples: {
    minimum: number;
    maximum: number;
    maximumBytes: number;
    maximumTotalBytes: number;
    minimumSecondsTotal: number;
    maximumSecondsEach: number;
    /** Member-facing labels ("MP3, WAV, M4A") and the accept attribute's types. */
    formatLabels: string[];
    acceptMimeTypes: string[];
    acceptExtensions: string[];
  };
  consentStatement: string;
  requireConsentName: boolean;
  pricingVersion: number;
}

export function publicVoiceCloneConfig(
  c: VoiceCloneConfig,
  currency: { code: string; symbol: string },
  opts: { usable: boolean; audience: string; isAdmin: boolean },
): VoiceClonePublicConfig {
  const allowed = VOICE_CLONE_SAMPLE_FORMATS.filter((f) => c.samples.formats.includes(f.id));
  const price = c.perCloneCents > 0 ? `${currency.symbol}${(c.perCloneCents / 100).toFixed(2)} a voice` : null;
  const freeLine = c.freeClonesPerMonth > 0 ? (c.freeClonesPerMonth === 1 ? "Your first voice each month is free" : `${c.freeClonesPerMonth} free voices a month`) : null;
  return {
    enabled: c.enabled && opts.usable,
    currency: currency.code,
    symbol: currency.symbol,
    priceLine: freeLine && price ? `${freeLine}, then ${price}` : (freeLine ?? price),
    perCloneCents: c.perCloneCents,
    freeClonesPerMonth: c.freeClonesPerMonth,
    slots: voiceCloneSlotsFor(c, opts),
    samples: {
      minimum: c.samples.minimum,
      maximum: c.samples.maximum,
      maximumBytes: c.samples.maximumBytes,
      maximumTotalBytes: c.samples.maximumTotalBytes,
      minimumSecondsTotal: c.samples.minimumSecondsTotal,
      maximumSecondsEach: c.samples.maximumSecondsEach,
      formatLabels: allowed.map((f) => f.label),
      /*
        🔴 `audio/*` FIRST AND NO CONTAINER TYPES (2026-09-27). The list used to
        be every MIME type this tool accepts, which includes `audio/mp4` — and
        an iOS picker asked for an mp4 type opens the PHOTO LIBRARY with every
        video in it. The owner saw a video option on a tool that refuses video.
        `audio/*` asks the OS for sound and nothing else; the extensions ride
        along for desktop browsers that match on those instead.
      */
      acceptMimeTypes: ["audio/*"],
      acceptExtensions: allowed.flatMap((f) => f.extensions.map((e) => `.${e}`)),
    },
    consentStatement: c.consentStatement,
    requireConsentName: c.requireConsentName,
    pricingVersion: c.pricingVersion,
  };
}
