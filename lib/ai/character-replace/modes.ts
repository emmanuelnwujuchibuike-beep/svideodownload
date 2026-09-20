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

/**
 * ── 2026-09-20 (the replacement-scope brief): FOUR customer modes ───────────
 *
 *   face_only       FACE_ONLY       "Face Only"       xrunda/hello (default)
 *   skin_face       FACE_HEAD       "Face + Head"     prunaai/p-video-replace (default)
 *   upper_body      UPPER_BODY      "Upper Body"      a body/appearance-capable model — Wan 2.2 (default)
 *   full_character  FULL_CHARACTER  "Full Character"  wan-video/wan-2.2-animate-replace
 *
 * `skin_face` is the STORED id of the "Face + Head" outcome — that mode has
 * always transferred the face, identity and exposed skin (the head's
 * appearance) while keeping the body, which is exactly the brief's FACE_HEAD.
 * Renaming the id would rewrite every job row, ledger snapshot, quote
 * signature and admin key for no customer-visible gain, so the id stays and
 * the words change. The customer vocabulary is the brief's, everywhere.
 *
 * The provider behind a mode is configuration (`modes[mode].provider.model`,
 * see providers/router.ts): the registry picks the adapter that declares it
 * supports the mode, so an operator can move Upper Body to a dedicated model
 * the day one exists without touching this file or the interface.
 */
export type ReplacementMode = "face_only" | "skin_face" | "upper_body" | "full_character";

export const REPLACEMENT_MODES: readonly ReplacementMode[] = ["face_only", "skin_face", "upper_body", "full_character"] as const;

/** The brief's own names for the four scopes, for analytics and operator screens. */
export const REPLACEMENT_SCOPE: Record<ReplacementMode, "FACE_ONLY" | "FACE_HEAD" | "UPPER_BODY" | "FULL_CHARACTER"> = {
  face_only: "FACE_ONLY",
  skin_face: "FACE_HEAD",
  upper_body: "UPPER_BODY",
  full_character: "FULL_CHARACTER",
};

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
  /**
   * What the reference photo must show for this scope (brief §3, §14). Read by
   * the photo step (the words), the create route and the worker (the
   * measurable parts). A portrait is never asked for a full body, and a
   * full-body photo is never cropped to pretend it is another mode.
   */
  photo: {
    /** The one-line "best results" sentence shown once the mode is chosen. */
    best: string;
    /** The framing the photo should have. */
    framing: "portrait" | "head_shoulders" | "half_body" | "full_body";
    /** Shortest edge in pixels the worker accepts for this scope. */
    minEdge: number;
    /** Photos WIDER than this width/height ratio are refused: a landscape photo cannot hold a standing person. */
    maxAspect: number;
  };
}

export const REPLACEMENT_MODE_COPY: Record<ReplacementMode, ReplacementModeCopy> = {
  face_only: {
    id: "face_only",
    label: "Face Only",
    tagline: "Replace the face while keeping the original body and clothing.",
    explanation:
      "Face Only changes the facial identity while keeping the original video character and scene — the body, clothing, jersey, logos, text, hairstyle, hands, pose, movement, background, camera and lighting stay as they were wherever the model can keep them.",
    reference: {
      title: "Reference face",
      hint: "One clear, front-facing portrait of the face. A selfie works well — no full-body photo needed.",
      /*
        🔴 The fourth line is the answer to "terrible results" (owner,
        2026-09-20, twice). Checked against the jobs themselves: the same
        pipeline, the same model version, the same settings and the same
        photo gave a clean Face Only result on a video of a similar-looking
        person (dfdcbb26, d8903a8e) and a "terrible" one on a video of a
        person with a different skin tone or hair (ade6e3d0, 62eb2e1e) —
        because Face Only swaps the facial features and keeps the video's
        own skin and hair, so the result looks like neither. Skin + Face on
        the very same video and photo (480d51b0) was clean. Nothing degrades
        with repeated runs; the pairing decides. Members are told which mode
        fits before they pay for the wrong one.
      */
      guidance: [
        "A sharp, well-lit face looking towards the camera gives the best swap.",
        "Sunglasses, heavy shadows and very small faces make the result worse.",
        "Only the face is used — the rest of the photo is ignored.",
        "The video's own skin tone and hair stay. If the photo's skin tone or hair is different, choose Face + Head — the result will look much more like the photo.",
      ],
    },
    maxReferenceImages: 1,
    photo: { best: "Best results: clear front-facing portrait with good lighting.", framing: "portrait", minEdge: 256, maxAspect: 2.2 },
  },
  skin_face: {
    id: "skin_face",
    label: "Face + Head",
    tagline: "Replace the face and head appearance while keeping the original body.",
    explanation:
      "Face + Head transfers the reference person's face, identity and skin — the whole head's appearance — while keeping the original video's body, clothing, movement, scene and camera wherever possible. The model is generative, so clothing, logos, text and colours may still change slightly.",
    reference: {
      title: "Reference identity",
      hint: "A clear head-and-shoulders photo of the person. Up to three photos of the same person help the identity.",
      guidance: [
        "Head and shoulders visible, face and hair clear — one to three photos of the same person, different angles help.",
        "A bit of neck and arms in the photo helps the skin tone come across.",
        "Photos of different people confuse the identity — keep it to one person.",
      ],
    },
    maxReferenceImages: 3,
    photo: { best: "Best results: head and shoulders visible, clear face and hair.", framing: "head_shoulders", minEdge: 256, maxAspect: 2.0 },
  },
  upper_body: {
    id: "upper_body",
    label: "Upper Body",
    tagline: "Replace your face, head, torso and upper-body appearance.",
    explanation:
      "Upper Body replaces the person's face, head, torso and upper-body appearance — including what they wear above the waist — while keeping the original movement, expressions, scene and camera. It is made for videos framed from the waist up; what the video shows is what gets replaced.",
    reference: {
      title: "Your photo",
      hint: "A clear chest- or waist-up photo, in clothes that suit the video. The face and the upper-body look in the photo are what go into the video.",
      guidance: [
        "Chest- or waist-up, well lit, facing the camera — the face and the top you are wearing both carry across.",
        "Use a video framed from the waist up; on a full-length video the model still replaces what it can see of the person.",
        "To change only the face, choose Face Only; for the whole person and outfit, choose Full Character.",
      ],
    },
    maxReferenceImages: 1,
    photo: { best: "Best results: chest/waist-up photo with your clothing clearly visible.", framing: "half_body", minEdge: 320, maxAspect: 1.6 },
  },
  full_character: {
    id: "full_character",
    label: "Full Character",
    tagline: "Replace the entire character while preserving the video's movement, expressions and scene.",
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
    photo: { best: "Best results: full-body photo with one person clearly visible.", framing: "full_body", minEdge: 384, maxAspect: 1.4 },
  },
};

/** The customer's one-line "best results" sentence and the measurable requirements of a scope (brief §3, §14). */
export function replacementPhotoGuidance(mode: ReplacementMode): ReplacementModeCopy["photo"] {
  return REPLACEMENT_MODE_COPY[mode].photo;
}

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

/** Upper Body rides a body/appearance-capable model — Wan today — so its tiers are Wan's resolutions. */
export interface UpperBodyProviderSettings {
  resolution: "480" | "720";
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
  // The notes reach the member (the quality card's line and the sentence under it) — plain words, no model talk (Part 9 §7).
  standard: { support: "supported", settings: { quality: "single" }, note: "Face Only has one quality — the face is swapped at the video's own resolution." },
  high: { support: "unsupported", settings: null, note: "Not available for Face Only yet." },
  ultra: { support: "unsupported", settings: null, note: "Not available for Face Only yet." },
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
  standard: { support: "supported", settings: { resolution: "720p", turbo: true, target_fps: "original" }, note: "720p, the fastest setting." },
  high: { support: "supported", settings: { resolution: "720p", turbo: false, target_fps: "original" }, note: "720p at full quality." },
  ultra: { support: "supported", settings: { resolution: "1080p", turbo: false, target_fps: "original" }, note: "1080p at full quality — the slowest." },
};

export const UPPER_BODY_TIER_MAP: Record<ReplacementTierId, TierMapping<UpperBodyProviderSettings>> = {
  standard: { support: "supported", settings: { resolution: "480" }, note: "480p — quick, a little soft on faces." },
  high: { support: "supported", settings: { resolution: "720" }, note: "720p — the recommended quality." },
  ultra: { support: "unsupported", settings: null, note: "1080p isn't offered for Upper Body yet." },
};

/** A mode configured as tiers (every mode but Full Character, whose tiers are the top-level qualities). */
export type TieredMode = Exclude<ReplacementMode, "full_character">;

export type AnyTierSettings = FaceOnlyProviderSettings | SkinFaceProviderSettings | UpperBodyProviderSettings;

export function tierMapFor(mode: TieredMode): Record<ReplacementTierId, TierMapping<AnyTierSettings>> {
  return mode === "face_only" ? FACE_ONLY_TIER_MAP : mode === "skin_face" ? SKIN_FACE_TIER_MAP : UPPER_BODY_TIER_MAP;
}

export function tierSupport(mode: TieredMode, tier: ReplacementTierId): TierMapping<AnyTierSettings> {
  return tierMapFor(mode)[tier];
}

/**
 * The closest SUPPORTED tier at or below the one asked for — for the Skin +
 * Face brief's "automatically use the closest supported configuration". Only
 * called after `validateQuoteInput` has accepted the tier, so today it is the
 * identity; it exists so a future model with a missing middle tier degrades
 * to the next one down rather than sending an invalid parameter.
 */
export function closestSupportedTier(mode: TieredMode, tier: ReplacementTierId): ReplacementTierId | null {
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
export type ReplacementOperation = "face_only" | "skin_face" | "upper_body" | "full_character";

export function operationForMode(mode: ReplacementMode): ReplacementOperation {
  return mode;
}

/* ───────────────────── the models an operator may route a scope to ──────── */

/**
 * The replacement models this build carries an adapter for, and the scopes
 * each can serve — the OPERATOR's vocabulary (the admin "Provider" select),
 * never a member's. Pure so the admin form can read it; the router's
 * adapters (providers/*.ts) declare the same facts and a test keeps the two
 * in step. A model that is not here cannot be chosen, whatever a request says.
 */
export const KNOWN_REPLACEMENT_MODELS: readonly { model: string; label: string; modes: readonly ReplacementMode[] }[] = [
  { model: "xrunda/hello", label: "Face swap (xrunda/hello)", modes: ["face_only"] },
  { model: "prunaai/p-video-replace", label: "Identity & skin (prunaai/p-video-replace)", modes: ["skin_face"] },
  { model: "wan-video/wan-2.2-animate-replace", label: "Wan 2.2 Animate Replace", modes: ["upper_body", "full_character"] },
];

export function knownModelsFor(mode: ReplacementMode): readonly { model: string; label: string }[] {
  return KNOWN_REPLACEMENT_MODELS.filter((m) => m.modes.includes(mode)).map(({ model, label }) => ({ model, label }));
}

export function modelServesMode(model: string, mode: ReplacementMode): boolean {
  return KNOWN_REPLACEMENT_MODELS.some((m) => m.model === model && m.modes.includes(mode));
}
