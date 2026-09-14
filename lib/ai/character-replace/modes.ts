/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACEMENT MODES — three ways to put a person into a video
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14 (Part 6): "a previous video character replace I did came
 * out terrible… we will implement 2 models for only face replace and face and
 * skin replace". The brief that followed names the three modes and the model
 * behind each:
 *
 *   face_only       xrunda/hello               swap the face; keep everything else
 *   skin_face       prunaai/p-video-replace    identity + exposed skin; keep clothes, scene
 *   full_character  wan-video/wan-2.2-animate-replace   the whole character (Parts 1–5)
 *
 * This module is PURE and is the one place the three are enumerated: their
 * ids, their customer-facing names and sentences, which quality tiers each
 * mode understands, and how a tier maps onto what the provider can actually
 * be asked for. The provider adapters (providers/*.ts) build payloads from the
 * mapping here; the pricing engine reads the tier ids; the interface reads the
 * copy. Nothing here knows a URL, a token or a job.
 *
 * ── 🔴 A TIER NEVER PRETENDS (Face Only brief §4, Skin + Face brief §5) ─────
 *
 * "Never pretend a higher quality is being generated if the underlying model
 * does not support that quality." Every tier row below says, in
 * `providerSupport`, whether choosing it changes anything the provider does.
 * xrunda/hello exposes no quality control at all, so its High and Ultra rows
 * are `unsupported` — kept in the vocabulary so the pricing system and the
 * admin form are ready for a model that has them, drawn disabled and
 * labelled in the interface, and REFUSED by `validateQuoteInput` until an
 * operator enables a tier a provider can honour. p-video-replace documents
 * 720p and 1080p and a turbo switch, so its three tiers are three genuinely
 * different provider configurations.
 */

export type ReplacementMode = "face_only" | "skin_face" | "full_character";

export const REPLACEMENT_MODES: readonly ReplacementMode[] = ["face_only", "skin_face", "full_character"] as const;

export function isReplacementMode(value: unknown): value is ReplacementMode {
  return typeof value === "string" && (REPLACEMENT_MODES as readonly string[]).includes(value);
}

/** The quality vocabulary of the two new modes. Full Character keeps 480p/720p/1080p (config.ts). */
export type ReplacementTierId = "standard" | "high" | "ultra";

export const REPLACEMENT_TIER_IDS: readonly ReplacementTierId[] = ["standard", "high", "ultra"] as const;

export function isReplacementTierId(value: unknown): value is ReplacementTierId {
  return typeof value === "string" && (REPLACEMENT_TIER_IDS as readonly string[]).includes(value);
}

/* ───────────────────────────── customer copy ─────────────────────────────── */

export interface ReplacementModeCopy {
  id: ReplacementMode;
  label: string;
  /** One line under the label on the selector. */
  tagline: string;
  /**
   * The preservation sentence the interface MUST show (Face Only brief §9,
   * Skin + Face brief §11). Written to be true of a generative model: what
   * is changed, what is kept "wherever possible", never "pixel-perfect".
   */
  explanation: string;
  /** The reference picker's heading and hint for this mode. */
  reference: { title: string; hint: string; guidance: readonly string[] };
  /** How many reference images the mode can use at most (the operator may lower it). */
  maxReferenceImages: number;
}

export const REPLACEMENT_MODE_COPY: Record<ReplacementMode, ReplacementModeCopy> = {
  face_only: {
    id: "face_only",
    label: "Face Only",
    tagline: "Swap the face. Keep the body, clothes and scene.",
    explanation:
      "Face Only changes the facial identity while keeping the original video character and scene — the body, clothing, jersey, logos, text, hairstyle, hands, pose, movement, background, camera and lighting stay as they were wherever the model can keep them.",
    reference: {
      title: "Reference face",
      hint: "One clear, front-facing photo of the face. A selfie works well.",
      guidance: [
        "A sharp, well-lit face looking towards the camera gives the best swap.",
        "Sunglasses, heavy shadows and very small faces make the result worse.",
        "Only the face is used — the rest of the photo is ignored.",
      ],
    },
    maxReferenceImages: 1,
  },
  skin_face: {
    id: "skin_face",
    label: "Skin + Face",
    tagline: "Bring the person's identity and skin. Keep the clothes and scene.",
    explanation:
      "Skin + Face transfers the reference person's identity, face and exposed skin while keeping the original video's clothing, body movement, scene and camera wherever possible. The model is generative, so clothing, logos, text and colours may still change slightly.",
    reference: {
      title: "Reference identity",
      hint: "Use clear reference images of the same person for better identity consistency.",
      guidance: [
        "One to three photos of the same person — different angles help.",
        "Show the face clearly; a bit of neck and arms helps the skin tone.",
        "Photos of different people confuse the identity — keep it to one person.",
      ],
    },
    maxReferenceImages: 3,
  },
  full_character: {
    id: "full_character",
    label: "Full Character",
    tagline: "Replace the whole person — face, body and clothes.",
    explanation:
      "Full Character replaces the entire person in the video with the person in your photo — face, body and clothing — while keeping the original movement, expressions, scene and camera motion.",
    reference: {
      title: "Your photo",
      hint: "A full-figure photo, in clothes that suit the video. The whole look in the photo is what goes into the video.",
      guidance: [
        "Everything in the photo carries across — face, body AND clothes. A beach selfie puts a beach outfit in the video.",
        "A full-body or three-quarter, well-lit photo on a plain background gives the model the build and the outfit to carry across.",
        "To keep the original person's body and clothes and change only the face, choose Face Only instead.",
      ],
    },
    maxReferenceImages: 1,
  },
};

export function replacementModeLabel(mode: ReplacementMode): string {
  return REPLACEMENT_MODE_COPY[mode].label;
}

/* ───────────────────────────── the provider mapping ──────────────────────── */

/**
 * What choosing a tier does at the provider. `unsupported` is the honest
 * answer for a model with no such control: the tier exists in the vocabulary
 * and is refused until a provider can honour it.
 */
export type TierProviderSupport = "supported" | "unsupported";

/** xrunda/hello: two inputs and nothing else. Every tier is the same run. */
export interface FaceOnlyProviderSettings {
  /** The model has no quality control; recorded so the row says so. */
  quality: "single";
}

/** prunaai/p-video-replace: the knobs the live schema documents. */
export interface SkinFaceProviderSettings {
  resolution: "720p" | "1080p";
  turbo: boolean;
  target_fps: "original" | "24" | "48";
}

export interface TierMapping<TSettings> {
  support: TierProviderSupport;
  /** Null when unsupported. */
  settings: TSettings | null;
  /** The sentence the admin form and the tier chip show. */
  note: string;
}

/**
 * ── FACE ONLY → xrunda/hello ────────────────────────────────────────────────
 * The live schema (2026-09-14, version 104b4a39…) is `source` (the video) and
 * `target` (the face image). No resolution, no fps, no strength. Standard is
 * the one configuration the model has; High and Ultra cannot be honoured.
 */
export const FACE_ONLY_TIER_MAP: Record<ReplacementTierId, TierMapping<FaceOnlyProviderSettings>> = {
  standard: { support: "supported", settings: { quality: "single" }, note: "The model's one and only configuration." },
  high: { support: "unsupported", settings: null, note: "This model has no higher setting — held for a future model." },
  ultra: { support: "unsupported", settings: null, note: "This model has no higher setting — held for a future model." },
};

/**
 * ── SKIN + FACE → prunaai/p-video-replace ───────────────────────────────────
 * The live schema (2026-09-14, version 4638788b…) documents `resolution`
 * 720p | 1080p ("target ~megapixel budget"), `turbo` ("faster generation for
 * slightly lower quality") and `target_fps` original | 24 | 48. Three tiers,
 * three real configurations — nothing invented:
 *
 *   standard   720p, turbo        the fast, cheaper run
 *   high       720p, full quality
 *   ultra      1080p, full quality
 *
 * `target_fps` stays `original` on every tier: resampling the frame rate
 * changes the duration the member was priced for.
 */
export const SKIN_FACE_TIER_MAP: Record<ReplacementTierId, TierMapping<SkinFaceProviderSettings>> = {
  standard: { support: "supported", settings: { resolution: "720p", turbo: true, target_fps: "original" }, note: "720p, turbo mode — fastest." },
  high: { support: "supported", settings: { resolution: "720p", turbo: false, target_fps: "original" }, note: "720p, full quality." },
  ultra: { support: "supported", settings: { resolution: "1080p", turbo: false, target_fps: "original" }, note: "1080p, full quality." },
};

export function tierSupport(mode: Exclude<ReplacementMode, "full_character">, tier: ReplacementTierId): TierMapping<FaceOnlyProviderSettings | SkinFaceProviderSettings> {
  return mode === "face_only" ? FACE_ONLY_TIER_MAP[tier] : SKIN_FACE_TIER_MAP[tier];
}

/**
 * The closest SUPPORTED tier at or below the one asked for — for the Skin +
 * Face brief's "automatically use the closest supported configuration". Only
 * called after `validateQuoteInput` has accepted the tier, so today it is the
 * identity; it exists so a future model with a missing middle tier degrades
 * to the next one down rather than sending an invalid parameter.
 */
export function closestSupportedTier(mode: Exclude<ReplacementMode, "full_character">, tier: ReplacementTierId): ReplacementTierId | null {
  const order: ReplacementTierId[] = ["ultra", "high", "standard"];
  const start = order.indexOf(tier);
  for (let i = Math.max(0, start); i < order.length; i++) {
    const candidate = order[i]!;
    if (tierSupport(mode, candidate).support === "supported") return candidate;
  }
  return null;
}

/* ───────────────────────────── the preservation prompt ───────────────────── */

/**
 * The instruction sent to p-video-replace (Skin + Face brief §4), verbatim
 * from the owner. It is NOT shown to members and it makes no promise to
 * them — the interface's sentence is `REPLACEMENT_MODE_COPY.skin_face.explanation`.
 */
export const SKIN_FACE_PRESERVATION_PROMPT =
  "Replace the identity of the person in the source video using the provided reference identity. Preserve the original video's exact body movement, pose, clothing, jersey, shirt, shorts, trousers, shoes, logos, text, numbers, colors, patterns, fabric details, background, camera movement, scene composition and lighting wherever possible. Do not redesign, recolor, regenerate or replace the clothing. Modify only the person's face, identity and naturally exposed skin areas. Maintain temporal consistency across all frames. Keep the original audio.";

/* ───────────────────────────── history / usage labels ────────────────────── */

/** `operation` as the usage record names it (Face Only brief §7, Skin + Face brief §10). */
export type ReplacementOperation = "face_only" | "skin_face" | "full_character";

export function operationForMode(mode: ReplacementMode): ReplacementOperation {
  return mode;
}
